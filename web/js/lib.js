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
function passes_spam_filter(contacts, ev, pow) {
	log_warn("passes_spam_filter deprecated, use event_is_spam");
	return !event_is_spam(ev, contacts, pow);
}

