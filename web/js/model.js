/* model_process_event is the main point where events are post-processed from
 * a relay. Additionally other side effects happen such as notification checks
 * and fetching of unknown pubkey profiles.
 */
function model_process_event(model, ev) {
	ev.refs = event_get_tag_refs(ev.tags)
	ev.pow = event_calculate_pow(ev)
	ev.is_spam = !event_is_spam(ev, model.contacts, model.pow);

	// Process specific event needs based on it's kind. Not using a map because
	// integers can't be used.
	let fn;
	switch(ev.kind) {
		case 0:
			fn = model_process_event_profile;
			break;
		case 3:
			fn = model_process_event_contact;
			break;
		case 5:
			fn = model_process_event_deletion;
			break;
		case 7:
			fn = model_process_event_reaction;
			break;
	}
	if (fn)
		fn(model, ev);

	//  not handling chatrooms for now
	//	else if (ev.kind === 42 && ev.refs && ev.refs.root)
	//		notice_chatroom(damus, ev.refs.root)
	//	else if (ev.kind === 40)
	//		event_process_chatroom(damus, ev)
	
	// check if the event that just came in should notify the user and is newer
	// than the last recorded notification event, if it is notify
	const notify_user = event_refs_pubkey(ev, model.pubkey)
	const last_notified = get_local_state('last_notified_date')
	ev.notified = notify_user;
	if (notify_user && (last_notified == null || ((ev.created_at*1000) > last_notified))) {
		set_local_state('last_notified_date', new Date().getTime());
		model.notifications++;
		update_title(model);
	}

	// If we find some unknown ids lets schedule their subscription for info
	if (model_event_has_unknown_ids(model, ev))
		schedule_unknown_refetch(model);
}

//function process_chatroom_event(model, ev) {
//	model.chatrooms[ev.id] = safe_parse_json(ev.content, 
//		"chatroom create event");
//}

/* model_process_event_profile updates the matching profile with the contents found 
 * in the event.
 */
function model_process_event_profile(model, ev) {
	const prev_ev = model.all_events[model.profile_events[ev.pubkey]]
	if (prev_ev && prev_ev.created_at > ev.created_at)
		return
	model.profile_events[ev.pubkey] = ev.id
	model.profiles[ev.pubkey] = safe_parse_json(ev.content, "profile contents")
}

/* model_process_event_reaction updates the reactions dictionary
 */
function model_process_event_reaction(model, ev) {
	if (!is_valid_reaction_content(ev.content))
		return
	let last = {}
	for (const tag of ev.tags) {
		if (tag.length >= 2 && (tag[0] === "e" || tag[0] === "p"))
			last[tag[0]] = tag[1]
	}
	if (last.e) {
		model.reactions_to[last.e] = model.reactions_to[last.e] || new Set()
		model.reactions_to[last.e].add(ev.id)
	}
}

function model_process_event_contact(model, ev) {
	load_our_contacts(model.contacts, model.pubkey, ev)
	load_our_relays(model.pubkey, model.pool, ev)
	add_contact_if_friend(model.contacts, ev)
}

/* event_process_deletion updates the list of deleted events.
 */
function model_process_event_deletion(model, ev) {
	for (const tag of ev.tags) {
		if (tag.length >= 2 && tag[0] === "e") {
			const evid = tag[1]
			// we've already recorded this one as a valid deleted
			// event we can just ignore it
			if (model.deleted[evid])
				continue
			let ds = model.deletions[evid] =
				(model.deletions[evid] || new Set())
			// add the deletion event id to the deletion set of
			// this event we will use this to determine if this
			// event is valid later in case we don't have the
			// deleted event yet.
			ds.add(ev.id)
		}
	}
}

/* model_event_has_unknown_ids checks the event if there are any referenced keys with
 * unknown user profiles in the provided scope.
 */
function model_event_has_unknown_ids(damus, ev) {
	// make sure this event itself is removed from unknowns
	if (ev.kind === 0)
		delete damus.unknown_pks[ev.pubkey]
	delete damus.unknown_ids[ev.id]
	let got_some = false
	for (const tag of ev.tags) {
		if (tag.length >= 2) {
			if (tag[0] === "p") {
				const pk = tag[1]
				if (!model_has_profile(damus, pk) && is_valid_id(pk)) {
					got_some = true
					damus.unknown_pks[pk] = make_unk(tag[2], ev)
				}
			} else if (tag[0] === "e") {
				const evid = tag[1]
				if (!model_has_event(damus, evid) && is_valid_id(evid)) {
					got_some = true
					damus.unknown_ids[evid] = make_unk(tag[2], ev)
				}
			}
		}
	}
	return got_some
}

function model_is_event_deleted(model, evid) {
	// we've already know it's deleted
	if (model.deleted[evid])
		return model.deleted[evid]

	const ev = model.all_events[evid]
	if (!ev)
		return false

	// all deletion events
	const ds = model.deletions[ev.id]
	if (!ds)
		return false

	// find valid deletion events
	for (const id of ds.keys()) {
		const d_ev = model.all_events[id]
		if (!d_ev)
			continue
		
		// only allow deletes from the user who created it
		if (d_ev.pubkey === ev.pubkey) {
			model.deleted[ev.id] = d_ev
			log_debug("received deletion for", ev)
			// clean up deletion data that we don't need anymore
			delete model.deletions[ev.id]
			return true
		} else {
			log_debug(`User ${d_ev.pubkey} tried to delete ${ev.pubkey}'s event ... what?`)
		}
	}
	return false
}

function model_has_profile(model, pk) {
	return pk in model.profiles
}

function model_has_event(model, evid) {
	return evid in model.all_events
}

/* model_relay_update_lok returns a map of kinds found in all events based on 
 * the last seen event of each kind. It also updates the model's cached value.
 * If the cached value is found it returns that instead
 */
function model_relay_update_lok(model, relay) {
	let last_of_kind = model.last_event_of_kind[relay];
	if (!last_of_kind) {
		last_of_kind = model.last_event_of_kind[relay] 
			= calculate_last_of_kind(model.all_events);
	}
	return last_of_kind;
}

function model_subscribe_defaults(model, relay) {
	const lok = model_relay_update_lok(model, relay);
	const filters = filters_new_default_since(model, lok);
	filters_subscribe(filters, model.pool, [relay]);
}

function new_model() {
	return {
		done_init: {},
		notifications: 0,
		max_depth: 2,
		all_events: {},
		reactions_to: {},
		chatrooms: {},
		unknown_ids: {},
		unknown_pks: {},
		deletions: {},
		but_wait_theres_more: 0,
		cw_open: {},
		views: {
			home: new_timeline('home'),
			explore: {
				...new_timeline('explore'),
				seen: new Set(),
			},
			notifications: {
				...new_timeline('notifications'),
				max_depth: 1,
			},
			profile: new_timeline('profile'),
			thread: new_timeline('thread'),
		},
		pow: 0, // pow difficulty target
		deleted: {},
		profiles: {},
		profile_events: {},
		last_event_of_kind: {},
		contacts: {
			event: null,
			friends: new Set(),
			friend_of_friends: new Set(),
		},
	}
}

function new_timeline(name) {
	return {
		name,
		events: [],
		rendered: new Set(),
		depths: {},
		expanded: new Set(),
	}
}
