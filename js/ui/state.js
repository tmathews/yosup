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
	const now = new Date().getTime();

	// Don't do anything if we are already here
	if (el.dataset.mode == mode && (el.dataset.pubkey == opts.pubkey || 
		el.dataset.threadId == thread_id))
		return;

	// Fetch history for certain views
	if (mode == VM_THREAD) {
		view_show_spinner(true);
		fetch_thread_history(thread_id, model.pool);
	}
	if (pubkey && pubkey != model.pubkey) {
		view_show_spinner(true);
		fetch_profile(pubkey, model.pool);
	}
	if (mode == VM_NOTIFICATIONS) {
		reset_notifications(model);
	}

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
	find_node("#view header > label").innerText = names[mode];
	find_node("#nav > div[data-active]").dataset.active = names[mode].toLowerCase();
	find_node("#view [role='profile-info']").classList.toggle("hide", mode != VM_USER);
	find_node("#newpost").classList.toggle("hide", mode != VM_FRIENDS);
	find_node("#timeline").classList.toggle("reverse", mode == VM_THREAD);

	view_timeline_refresh(model, mode, opts);
	
	return mode;
}

/* view_timeline_refresh is a hack for redrawing the events in order
 */
function view_timeline_refresh(model, mode, opts={}) {
	const el = view_get_timeline_el();
	if (!mode) {
		mode = el.dataset.mode;
		opts.thread_id = el.dataset.threadId;
		opts.pubkey = el.dataset.pubkey;
	}
	// Remove all 
	// This is faster than removing one by one
	el.innerHTML = "";
	// Build DOM fragment and render it 
	let count = 0;
	const evs = model_events_arr(model)
	const fragment = new DocumentFragment();
	for (let i = evs.length - 1; i >= 0 && count < 1000; i--) {
		const ev = evs[i];
		if (!view_mode_contains_event(model, ev, mode, opts))
			continue;
		let ev_el = model.elements[ev.id];
		if (!ev_el)
			continue;
		fragment.appendChild(ev_el);
		count++;
	}
	if (count > 0) {
		el.append(fragment);
		view_set_show_count(0);
		view_timeline_update_timestamps();
		view_show_spinner(false);
	}
}

function view_show_spinner(show=true) {
	find_node("#view .loading-events").classList.toggle("hide", !show);
}

/* view_timeline_update iterates through invalidated event ids and updates the
 * state of the timeline and other factors such as notifications, etc.
 */
function view_timeline_update(model) {
	const el = view_get_timeline_el();
	const mode = el.dataset.mode;
	const opts = {
		thread_id: el.dataset.threadId,
		pubkey: el.dataset.pubkey,
	};

	let count = 0;
	let ncount = 0;
	const latest_ev = el.firstChild ? 
		model.all_events[el.firstChild.id.slice(2)] : undefined;
	const left_overs = [];
	while (model.invalidated.length > 0 && count < 500) {
		var evid = model.invalidated.pop();

		// Remove deleted events first
		if (model_is_event_deleted(model, evid)) {
			let x = model.elements[evid];
			if (x && x.parentElement) {
				x.parentElement.removeChild(x);	
				delete model.elements[evid];
			}
			continue;
		}

		// Skip non-renderables and already created
		var ev = model.all_events[evid];
		if (!event_is_renderable(ev) || model.elements[evid]) {
			continue;
		}

		// Put it back on the stack to re-render if it's not ready.
		if (!view_render_event(model, ev)) {
			left_overs.push(evid);
			continue;
		}

		// Increase notification count if needed
		if (event_refs_pubkey(ev, model.pubkey) && 
			ev.created_at > model.notifications.last_viewed) {
			ncount++;
		}

		// If the new element is newer than the latest & is viewable then
		// we want to increase the count of how many to add to view
		if (event_cmp_created(ev, latest_ev) >= 0 && 
			view_mode_contains_event(model, ev, mode, opts)) {
			count++;
		}
	}
	model.invalidated = model.invalidated.concat(left_overs);

	// If there are new things to show on our current view lets do it
	if (count > 0) {
		if (!latest_ev) {
			view_timeline_show_new(model);
		}
		view_set_show_count(count, true, false);	
	}
	// Update notification markers and count
	if (ncount > 0) {
		log_debug(`new notis ${ncount}`);
		model.notifications.count += ncount;
		update_notifications(model);
	}
}

function view_set_show_count(count, add=false, hide=false) {
	const show_el = find_node("#show-new")
	const num_el = find_node("#show-new span", show_el);
	if (add) {
		count += parseInt(num_el.innerText || 0)
	}
	num_el.innerText = count;
	show_el.classList.toggle("hide", hide || count <= 0);
}

function view_timeline_show_new(model) {
	const el = view_get_timeline_el();
	const mode = el.dataset.mode;
	const opts = {
		thread_id: el.dataset.threadId,
		pubkey: el.dataset.pubkey,
	};
	const latest_evid = el.firstChild ? el.firstChild.id.slice(2) : undefined;

	let count = 0;
	const evs = model_events_arr(model)
	const fragment = new DocumentFragment();
	for (let i = evs.length - 1; i >= 0 && count < 500; i--) {
		const ev = evs[i];
		if (latest_evid && ev.id == latest_evid) {
			break;
		}
		if (!view_mode_contains_event(model, ev, mode, opts))
			continue;
		let ev_el = model.elements[ev.id];
		if (!ev_el)
			continue;
		fragment.appendChild(ev_el);
		count++;
	}
	if (count > 0) {
		el.prepend(fragment);
		view_show_spinner(false);
		if (mode == VM_NOTIFICATIONS) {
			reset_notifications(model);
		}
	}
	view_set_show_count(-count, true);
	view_timeline_update_timestamps();
}

function view_render_event(model, ev, force=false) {
	if (model.elements[ev.id] && !force)
		return model.elements[ev.id];
	const html = render_event(model, ev, {});
	if (html == "") {
		//log_debug(`failed to render ${ev.id}`);
		return;
	}
	const div = document.createElement("div");
	div.innerHTML = html;
	const el = div.firstChild;
	model.elements[ev.id] = el;
	return el;
}

function view_timeline_update_profiles(model, pubkey) {
	let xs, html;
	const el = view_get_timeline_el();
	const p = model_get_profile(model, pubkey);
	const name = fmt_profile_name(p.data, fmt_pubkey(pubkey));
	const pic = get_picture(pubkey, p.data)
	for (const evid in model.elements) {
		if (!event_contains_pubkey(model.all_events[evid], pubkey))
			continue;
		const el = model.elements[evid];
		let xs;
		xs = find_nodes(`.username[data-pubkey='${pubkey}']`, el)
		xs.forEach((el)=> {
			el.innerText = name;
		});
		xs = find_nodes(`img[data-pubkey='${pubkey}']`, el)
		xs.forEach((el)=> {
			el.src = pic;
		});
	}
	// Update the profile view if it's active
	if (el.dataset.mode == VM_USER && el.dataset.pubkey == pubkey) {
		view_update_profile(model, pubkey);
	}
}

function view_timeline_update_timestamps() {
	// TODO only update elements that are fresh and are in DOM
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
	if (!o)
		return;
	const ev_id = o.e;
	const root = model.elements[ev_id];
	if (!root)
		return;

	// Update reaction groups
	el = find_node(`.reactions`, root);
	el.innerHTML = render_reactions_inner(model, model.all_events[ev_id]); 

	// Update like button
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
			if (ev.kind == KIND_SHARE) return false;
			return ev.id == opts.thread_id || (ev.refs && ( 
				ev.refs.root == opts.thread_id ||
				ev.refs.reply == opts.thread_id));
		case VM_NOTIFICATIONS:
			return event_refs_pubkey(ev, model.pubkey);
	}
	return false;
}

function event_is_renderable(ev={}) {
	return ev.kind == KIND_NOTE || ev.kind == KIND_SHARE;
}

function get_default_max_depth(damus, view) {
	return view.max_depth || damus.max_depth
}

function get_thread_max_depth(damus, view, root_id) {
	if (!view.depths[root_id])
		return get_default_max_depth(damus, view)

	return view.depths[root_id]
}

function get_thread_root_id(damus, id) {
	const ev = damus.all_events[id]
	if (!ev) {
		log_debug("expand_thread: no event found?", id)
		return null
	}
	return ev.refs && ev.refs.root
}

function switch_view(mode, opts) {
	view_timeline_apply_mode(DAMUS, mode, opts);
	close_gnav();
}

function reset_notifications(model) {
	model.notifications.count = 0;
	model.notifications.last_viewed = new_creation_time();
	update_notifications(model);
}

