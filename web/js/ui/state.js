const VM_FRIENDS = "friends"; // mine + only events that are from my contacts
const VM_EXPLORE = "explore"; // all events
const VM_NOTIFICATIONS = "notifications";  // reactions & replys
const VM_THREAD = "thread"; // all events in response to target event
const VM_USER = "user"; // all events by pubkey 

function view_get_timeline_el() {
	return find_node("#timeline");
}

function view_timeline_apply_mode(model, mode, opts={}) {
	let xs;
	const { pubkey, thread_id } = opts;
	const el = view_get_timeline_el();

	el.dataset.mode = mode;
	switch(mode) {
		case VM_THREAD:
			el.dataset.threadId = thread_id;
		case VM_USER:
			el.dataset.pubkey = pubkey;
			break;
		default:
			delete el.dataset.threadId;
			delete el.dataset.pubkey;
			break;
	}

	const names = {};
	names[VM_FRIENDS] = "Home";
	names[VM_EXPLORE] = "Explore";
	names[VM_NOTIFICATIONS] = "Notifications";
	names[VM_USER] = "Profile";
	names[VM_THREAD] = "Thread";

	// Do some visual updates
	find_node("#view header > label").innerText = mode == VM_USER ? 
		fmt_profile_name(DAMUS.profiles[opts.pubkey], fmt_pubkey(opts.pubkey)) : 
		names[mode];
	find_node("#nav > div[data-active]").dataset.active = names[mode].toLowerCase();
	find_node("#view [role='profile-info']").classList.toggle("hide", mode != VM_USER);
	find_node("#newpost").classList.toggle("hide", mode != VM_FRIENDS);
	find_node("#timeline").classList.toggle("reverse", mode == VM_THREAD);

	// Show or hide all applicable events related to the mode.
	xs = el.querySelectorAll(".event");
	for (const x of xs) {
		let evid = x.id.substr(2);
		let ev = model.all_events[evid];
		x.classList.toggle("hide", 
			!view_mode_contains_event(model, ev, mode, opts));
	}

	return mode;
}

/* view_timeline_update iterates through invalidated event ids and either adds
 * or removes them from the timeline.
 */
function view_timeline_update(model) {
	const el = view_get_timeline_el();
	const mode = el.dataset.mode;
	const opts = {
		thread_id: el.dataset.threadId,
		pubkey: el.dataset.pubkey,
	};

	// for each event not rendered, go through the list and render it marking 
	// it as rendered and adding it to the appropriate fragment. fragments are
	// created based on slices in the existing timeline. fragments are started
	// at the previous event
	// const fragments = {};
	// const cache = {};

	// Dumb function to insert needed events
	let visible_count = 0;
	const all = model_events_arr(model);
	while (model.invalidated.length > 0) {
		var evid = model.invalidated.pop();
		var ev = model.all_events[evid];
		if (!event_is_renderable(ev) || model_is_event_deleted(model, evid)) {
			let x = find_node("#ev"+evid, el);
			if (x) el.removeChild(x);
			continue;
		}

		// if event is in el already, do nothing or update?
		let ev_el = find_node("#ev"+evid, el);
		if (ev_el) {
			continue;
		} else {
			let div = document.createElement("div");
			div.innerHTML = render_event(model, ev, {});
			ev_el = div.firstChild;
			if (!view_mode_contains_event(model, ev, mode, opts)) {
				ev_el.classList.add("hide");
			} else {
				visible_count++;
			}
		}

		// find prior event element and insert it before that
		let prior_el;
		let prior_idx = arr_bsearch_insert(all, ev, event_cmp_created);
		while (prior_idx > 0 && !prior_el) {
			prior_el = find_node("#ev"+all[prior_idx].id, el);
			prior_idx--;
		}
		if (!prior_el) {
			el.appendChild(ev_el);
		} else {
			el.insertBefore(ev_el, prior_el);
		}
	}
	
	if (visible_count > 0)
		find_node("#view .loading-events").classList.add("hide");
}

function view_timeline_update_profiles(model, ev) {
	let xs, html;
	const el = view_get_timeline_el();
	const pk = ev.pubkey;
	const p = model.profiles[pk];

	// If it's my pubkey let's redraw my pfp that is not located in the view
	if (pk == model.pubkey) {
		redraw_my_pfp(model);
	}

	// Update displayed names
	xs = el.querySelectorAll(`.username[data-pubkey='${pk}']`)
	html = fmt_profile_name(p, fmt_pubkey(pk));
	for (const x of xs) {
		x.innerText = html;
	}

	// Update profile pictures
	xs = el.querySelectorAll(`img.pfp[data-pubkey='${pk}']`);
	html = get_picture(pk, p)
	for (const x of xs) {
		x.src = html;
	}
}

function view_timeline_update_timestamps(model) {
	const el = view_get_timeline_el();
	let xs = el.querySelectorAll(".timestamp");
	let now = new Date().getTime(); 
	for (const x of xs) {
		let t = parseInt(x.dataset.timestamp)
		x.innerText = fmt_since_str(now, t*1000); 
	}
}

function view_timeline_update_reaction(model, ev) {
	let el;
	const o = event_parse_reaction(ev);
	if (!o) {
		return;
	}
	const ev_id = o.e;
	const root = find_node(`#ev${ev_id}`);
	if (!root) {
		// It's possible the event didn't get rendered yet from the
		// invalidation stack. In which case emojis will get rendered then.
		return;
	}

	// Update reaction groups
	el = find_node(`.reactions`, root);
	el.innerHTML = render_reactions_inner(model, model.all_events[ev_id]); 

	if (ev.pubkey == model.pubkey) {
		const reaction = model_get_reacts_to(model, model.pubkey, ev_id, R_HEART);
		const liked = !!reaction;
		const img = find_node("button.icon.heart > img", root);
		const btn = find_node("button.icon.heart", root)
		btn.classList.toggle("liked", liked);
		btn.title = liked ? "Unlike" : "Like";
		btn.disabled = false;
		btn.dataset.liked = liked ? "yes" : "no";
		btn.dataset.reactionId = liked ? reaction.id : "";
		img.classList.toggle("dark-noinvert", liked);
		img.src = liked ? IMG_EVENT_LIKED : IMG_EVENT_LIKE;
	}
}

function view_mode_contains_event(model, ev, mode, opts={}) {
	switch(mode) {
		case VM_EXPLORE:
			return ev.kind != KIND_REACTION;
		case VM_USER:
			return opts.pubkey && ev.pubkey == opts.pubkey;
		case VM_FRIENDS:
			return ev.pubkey == model.pubkey || contact_is_friend(model.contacts, ev.pubkey);
		case VM_THREAD:
			return ev.id == opts.thread_id || (ev.refs && ( 
				ev.refs.root == opts.thread_id ||
				ev.refs.reply == opts.thread_id));
				//event_refs_event(ev, opts.thread_id);
		case VM_NOTIFICATIONS:
			return event_refs_pubkey(ev, model.pubkey);
	}
	return false;
}

function event_is_renderable(ev={}) {
	return ev.kind == KIND_NOTE;
	return ev.kind == KIND_NOTE || 
		ev.kind == KIND_REACTION || 
		ev.kind == KIND_DELETE;
}

function get_default_max_depth(damus, view) {
	return view.max_depth || damus.max_depth
}

function get_thread_max_depth(damus, view, root_id) {
	if (!view.depths[root_id])
		return get_default_max_depth(damus, view)

	return view.depths[root_id]
}

/*function expand_thread(id, reply_id) {
	const view = get_current_view()
	const root_id = get_thread_root_id(DAMUS, id)
	if (!root_id) {
		log_debug("could not get root_id for", DAMUS.all_events[id])
		return
	}
	view.expanded.add(reply_id)
	view.depths[root_id] = get_thread_max_depth(DAMUS, view, root_id) + 1
	redraw_events(DAMUS, view)
}*/

function get_thread_root_id(damus, id) {
	const ev = damus.all_events[id]
	if (!ev) {
		log_debug("expand_thread: no event found?", id)
		return null
	}
	return ev.refs && ev.refs.root
}

function switch_view(mode, opts) {
	log_warn("switch_view deprecated, use view_timeline_apply_mode");
	view_timeline_apply_mode(DAMUS, mode, opts);
}

