/* model_process_event is the main point where events are post-processed from
 * a relay. Additionally other side effects happen such as notification checks
 * and fetching of unknown pubkey profiles.
 */
function model_process_event(model, ev) {
	if (model.all_events[ev.id]) {
		return;
	}

	model.all_events[ev.id] = ev;
	ev.refs = event_get_tag_refs(ev.tags);
	ev.pow = event_calculate_pow(ev);

	// Process specific event needs based on it's kind. Not using a map because
	// integers can't be used.
	let fn;
	switch(ev.kind) {
		case KIND_METADATA:
			fn = model_process_event_profile;
			break;
		case KIND_CONTACT:
			fn = model_process_event_contact;
			break;
		case KIND_DELETE:
			fn = model_process_event_deletion;
			break;
		case KIND_REACTION:
			fn = model_process_event_reaction;
			break;
	}
	if (fn)
		fn(model, ev);

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

	// Queue event for rendering  
	model.invalidated.push(ev.id);
}

/* model_process_event_profile updates the matching profile with the contents found 
 * in the event.
 */
function model_process_event_profile(model, ev) {
	const prev_ev = model.all_events[model.profile_events[ev.pubkey]]
	if (prev_ev && prev_ev.created_at > ev.created_at)
		return
	model.profile_events[ev.pubkey] = ev.id
	model.profiles[ev.pubkey] = safe_parse_json(ev.content, "profile contents")
	view_timeline_update_profiles(model, ev);
}

function model_process_event_contact(model, ev) {
	contacts_process_event(model.contacts, model.pubkey, ev)
	load_our_relays(model.pubkey, model.pool, ev)
}

/* model_process_event_reaction updates the reactions dictionary
 */
function model_process_event_reaction(model, ev) {
	let reaction = event_parse_reaction(ev);
	if (!reaction) {
		return;
	}
	if (!model.reactions_to[reaction.e])
		model.reactions_to[reaction.e] = new Set();
	model.reactions_to[reaction.e].add(ev.id);	
	view_timeline_update_reaction(model, ev);
}

/* event_process_deletion updates the list of deleted events. Additionally
 * pushes event ids onto the invalidated stack for any found.
 */
function model_process_event_deletion(model, ev) {
	for (const tag of ev.tags) {
		if (tag.length >= 2 && tag[0] === "e" && tag[1]) {
			let evid = tag[1];
			model.invalidated.push(evid);
			model_remove_reaction(model, evid);
			if (model.deleted[evid])
				continue;
			let ds = model.deletions[evid] =
				(model.deletions[evid] || new Set());
			ds.add(ev.id);
		}
	}
}

function model_remove_reaction(model, evid) {
	// deleted_ev -> target_ev -> original_ev
	// Here we want to find the original react event to and remove it from our
	// reactions map, then we want to update the element on the page. If the 
	// server does not clean up events correctly the increment/decrement method
	// should work fine in theory.
	const target_ev = model.all_events[evid];
	if (!target_ev)
		return;
	const reaction = event_parse_reaction(target_ev);
	if (!reaction)
		return;
	if (model.reactions_to[reaction.e])
		model.reactions_to[reaction.e].delete(target_ev.id);
	view_timeline_update_reaction(model, target_ev);
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
			delete model.deletions[ev.id]
			return true
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

function model_events_arr(model) {
	const events = model.all_events;
	let arr = [];
	for (const evid in events) {
		const ev = events[evid];
		const i = arr_bsearch_insert(arr, ev, event_cmp_created); 
		arr.splice(i, 0, ev);
	}
	return arr;
}

function test_model_events_arr() {
	const arr = model_events_arr({all_events: {
		"c": {name: "c", created_at: 2},
		"a": {name: "a", created_at: 0},
		"b": {name: "b", created_at: 1},
		"e": {name: "e", created_at: 4},
		"d": {name: "d", created_at: 3},
	}});
	let last;	
	while(arr.length > 0) {
		let ev = arr.pop();
		log_debug("test:", ev.name, ev.created_at);
		if (!last) {
			last = ev;
			continue;
		}
		if (ev.created_at > last.created_at) {
			log_error(`ev ${ev.name} should be before ${last.name}`);
		}
		last = ev;
	}
}

async function model_save_events(model) {
	function _events_save(ev, resolve, reject) {
		const db = ev.target.result;
		let tx = db.transaction("events", "readwrite");
		let store = tx.objectStore("events");
		for (const evid in model.all_events) {
			store.put(model.all_events[evid]);
		}
		tx.oncomplete = (ev) => {
			db.close();
			resolve();
			log_debug("saved events!");
		};
		tx.onerror = (ev) => {
			db.close();
			log_error("failed to save events");
			reject(ev);
		};
	}
	return dbcall(_events_save);
}

async function model_load_events(model, fn) {
	function _events_load(ev, resolve, reject) {
		const db = ev.target.result;
		const tx = db.transaction("events", "readonly");
		const store = tx.objectStore("events");
		const cursor = store.openCursor();
		cursor.onsuccess = (ev) => {
			var cursor = ev.target.result;
			if (cursor) {
				fn(cursor.value);
				cursor.continue();
			} else {
				db.close();
				resolve();
				log_debug("Successfully loaded events");
			}
		}
		cursor.onerror = (ev) => {
			db.close();
			reject(ev);
			log_error("Could not load events.");
		};
	}
	return dbcall(_events_load);
}

function new_model() {
	return {
		all_events: {}, // our master list of all events
		done_init: {},
		notifications: 0,
		max_depth: 2,
		reactions_to: {},
		chatrooms: {},
		
		unknown_ids: {},
		unknown_pks: {},
		but_wait_theres_more: 0,
		
		deletions: {},
		deleted: {},
		last_event_of_kind: {},
		pow: 0, // pow difficulty target
		profiles: {}, // pubkey => profile data
		profile_events: {}, // pubkey => event id - use with all_events
		contacts: {
			event: null,
			friends: new Set(),
			friend_of_friends: new Set(),
		},
		invalidated: [], // event ids which should be added/removed
		elements: {}, // map of evid > rendered element
		requested_profiles: [], // an array of {relay_id, pubkey} to fetching

		ids: {
			comments:      "comments",
			explore:       "explore",
			refevents:     "refevents",
			account:       "account",
			home:          "home",
			contacts:      "contacts",
			notifications: "notifications",
			unknowns:      "unknowns",
			dms:           "dms",
		},
	};
}
