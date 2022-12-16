function load_our_relays(our_pubkey, pool, ev) {
	if (ev.pubkey != our_pubkey)
		return

	let relays
	try {
		relays = JSON.parse(ev.content)
	} catch (e) {
		log_error("error loading relays", e)
		return
	}

	for (const relay of Object.keys(relays)) {
		if (!pool.has(relay)) {
			log_debug("adding relay", relay)
			pool.add(relay)
		}
	}
}

function notice_chatroom(state, id) {
	if (!state.chatrooms[id])
		state.chatrooms[id] = {}
}

function should_add_to_notification_timeline(our_pk, contacts, ev, pow)
{
	if (!should_add_to_timeline(ev))
		return false

	// TODO: add items that don't pass spam filter to "message requests"
	// Then we will need a way to whitelist people as an alternative to
	// following them
	return passes_spam_filter(contacts, ev, pow)
}

function should_add_to_explore_timeline(contacts, view, ev, pow)
{
	if (!should_add_to_timeline(ev))
		return false

	if (view.seen.has(ev.pubkey))
		return false

	// hide friends for 0-pow situations
	if (pow === 0 && contacts.friends.has(ev.pubkey))
		return false

	return passes_spam_filter(contacts, ev, pow)
}

function handle_redraw_logic(model, view_name)
{
	const view = model.views[view_name]
	if (view.redraw_timer)
		clearTimeout(view.redraw_timer)
	view.redraw_timer = setTimeout(redraw_events.bind(null, model, view), 600)
}

/*
function handle_home_event(model, relay, sub_id, ev) {
	const ids = model.ids

	// ignore duplicates
	if (!has_event(model, ev.id)) {
		model.all_events[ev.id] = ev
		process_event(model, ev)
		schedule_save_events(model)
	}

	ev = model.all_events[ev.id]

	let is_new = true
	switch (sub_id) {
	case model.ids.explore:
		const view = model.views.explore

		// show more things in explore timeline
		if (should_add_to_explore_timeline(model.contacts, view, ev, model.pow)) {
			view.seen.add(ev.pubkey)
			is_new = insert_event_sorted(view.events, ev)
		}

		if (is_new)
			handle_redraw_logic(model, 'explore')
		break;

	case model.ids.notifications:
		if (should_add_to_notification_timeline(model.pubkey, model.contacts, ev, model.pow))
			is_new = insert_event_sorted(model.views.notifications.events, ev)

		if (is_new)
			handle_redraw_logic(model, 'notifications')
		break;

	case model.ids.home:
		if (should_add_to_timeline(ev))
			is_new = insert_event_sorted(model.views.home.events, ev)

		if (is_new)
			handle_redraw_logic(model, 'home')
		break;
	case model.ids.account:
		switch (ev.kind) {
		case 3:
			model.done_init[relay] = true
			model.pool.unsubscribe(model.ids.account, relay)
			send_home_filters(model, relay)
			break
		}
		break
	case model.ids.profiles:
		break
	}
}*/

function handle_profiles_loaded(ids, model, view, relay) {
	// stop asking for profiles
	model.pool.unsubscribe(ids.profiles, relay)

	//redraw_events(model, view)
	redraw_my_pfp(model)

	const prefix = difficulty_to_prefix(model.pow)
	const fofs = Array.from(model.contacts.friend_of_friends)
	const standard_kinds = [1,42,5,6,7]
	let pow_filter = {kinds: standard_kinds, limit: 50}
	if (model.pow > 0)
		pow_filter.ids = [ prefix ]

	let explore_filters = [ pow_filter ]

	if (fofs.length > 0) {
		explore_filters.push({kinds: standard_kinds, authors: fofs, limit: 50})
	}

	model.pool.subscribe(ids.explore, explore_filters, relay)
}

// load profiles after comment notes are loaded
function handle_comments_loaded(ids, model, events, relay) {
	const pubkeys = events.reduce((s, ev) => {
		s.add(ev.pubkey)
		for (const tag of ev.tags) {
			if (tag.length >= 2 && tag[0] === "p") {
				if (!model.profile_events[tag[1]])
					s.add(tag[1])
			}
		}
		return s
	}, new Set())
	const authors = Array.from(pubkeys)

	// load profiles and noticed chatrooms
	const profile_filter = {kinds: [0,3], authors: authors}

	let filters = []
	if (authors.length > 0)
		filters.push(profile_filter)
	if (filters.length === 0) {
		log_debug("No profiles filters to request...")
		return
	}

	//console.log("subscribe", profiles_id, filter, relay)
	log_debug("subscribing to profiles on %s", relay.url)
	model.pool.subscribe(ids.profiles, filters, relay)
}

/* DEPRECATED */

function is_deleted(model, evid) {
	log_warn("is_deleted deprecated, use model_is_event_deleted");
	return model_is_event_deleted(model, evid);
}
function process_event(model, ev) {
	log_warn("process_event deprecated, use event_process");
	return model_process_event(model, ev);
}
function calculate_pow(ev) {
	log_warn("calculate_pow deprecated, use event_calculate_pow");
	return event_calculate_pow(ev);
}
function insert_event_sorted(evs, new_ev) {
	log_warn("insert_event_sorted deprecated, use events_insert_sorted");
	events_insert_sorted(evs, new_ev);
}
function can_reply(ev) {
	log_warn("can_reply is deprecated, use event_can_reply");
	return event_can_reply(ev);
}
function should_add_to_timeline(ev) {
	// TODO rename should_add_to_timeline to is_timeline_event
	log_warn("should_add_to_timeline is deprecated, use event_is_timeline");
	return event_is_timeline(ev);
}

