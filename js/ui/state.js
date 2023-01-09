const VM_FRIENDS       = "friends"; // mine + only events that are from my contacts
const VM_EXPLORE       = "explore"; // all events
const VM_NOTIFICATIONS = "notifications";  // reactions & replys
const VM_DM            = "dm"; // all events of KIND_DM aimmed at user 
const VM_DM_THREAD     = "dmthread"; // all events from a user of KIND_DM 
const VM_THREAD        = "thread"; // all events in response to target event
const VM_USER          = "user"; // all events by pubkey 
const VM_SETTINGS      = "settings";

function view_get_timeline_el() {
	return find_node("#timeline");
}

// TODO clean up popstate listener (move to init method or such)
window.addEventListener("popstate", function(event) {
	if (event.state && event.state.mode) {
		// Update the timeline mode.
		// Pass pushState=false to avoid adding another state to the history
		view_timeline_apply_mode(DAMUS, event.state.mode, event.state.opts, false);
	}
})

function view_timeline_apply_mode(model, mode, opts={}, push_state=true) {
	let xs;
	const { pubkey, thread_id } = opts;
	const el = view_get_timeline_el();
	const now = new Date().getTime();

	// Don't do anything if we are already here
	if (el.dataset.mode == mode) {
		switch (mode) {
			case VM_DM_THREAD:
			case VM_USER:
				if (el.dataset.pubkey == opts.pubkey)
					return;
				break;
			case VM_THREAD:
				if (el.dataset.threadId == thread_id)
					return;
				break;
			default:
				return;
		}
	}
	
	// Push a new state to the browser history stack
	if (push_state)
		history.pushState({mode, opts}, '');
	
	// Fetch history for certain views
	if (mode == VM_THREAD) {
		view_show_spinner(true);
		fetch_thread_history(thread_id, model.pool);
	}
	if (mode == VM_USER && pubkey && pubkey != model.pubkey) {
		view_show_spinner(true);
		fetch_profile(pubkey, model.pool);
	}
	if (mode == VM_NOTIFICATIONS) {
		reset_notifications(model);
	}

	const names = {};
	names[VM_FRIENDS] = "Home";
	names[VM_EXPLORE] = "Explore";
	names[VM_NOTIFICATIONS] = "Notifications";
	names[VM_DM] = "Messages";
	names[VM_DM_THREAD] = "Messages";
	names[VM_USER] = "Profile";
	names[VM_THREAD] = "Thread";
	names[VM_SETTINGS] = "Settings";
	let name = names[mode];
	let profile;

	el.dataset.mode = mode;
	delete el.dataset.threadId;
	delete el.dataset.pubkey;
	switch(mode) {
		case VM_THREAD:
			el.dataset.threadId = thread_id;
			break;
		case VM_USER:
		case VM_DM_THREAD:
			profile = model_get_profile(model, pubkey);
			name = fmt_name(profile);
			el.dataset.pubkey = pubkey;
			break;
	}

	// Do some visual updates
	find_node("#view header > label").innerText = name;
	find_node("#nav > div[data-active]").dataset.active = names[mode].toLowerCase();
	find_node("#view [role='profile-info']").classList.toggle("hide", mode != VM_USER);
	find_node("#newpost").classList.toggle("hide", mode != VM_FRIENDS && mode != VM_DM_THREAD);
	const timeline_el = find_node("#timeline");
	timeline_el.classList.toggle("reverse", mode == VM_THREAD);
	timeline_el.classList.toggle("hide", mode == VM_SETTINGS || mode == VM_DM);
	find_node("#settings").classList.toggle("hide", mode != VM_SETTINGS);
	find_node("#dms").classList.toggle("hide", mode != VM_DM);
	find_node("#dms-not-available")
		.classList.toggle("hide", mode == VM_DM_THREAD || mode == VM_DM ? 
			dms_available() : true);

	// Show/hide different profile image in header
	el_their_pfp = find_node("#view header > img.pfp[role='their-pfp']");
	el_their_pfp.classList.toggle("hide", mode != VM_DM_THREAD);
	find_node("#view header > img.pfp[role='my-pfp']")
		.classList.toggle("hide", mode == VM_DM_THREAD);

	view_timeline_refresh(model, mode, opts);

	switch (mode) {
		case VM_DM_THREAD:
			decrypt_dms(model);
			model_dm_seen(model, pubkey);
			el_their_pfp.src = get_profile_pic(profile);
			el_their_pfp.dataset.pubkey = pubkey;
			break;
		case VM_DM:
			model.dms_need_redraw = true;
			//decrypt_dms(model);
			//view_dm_update(model);
			break;
		case VM_SETTINGS:
			view_show_spinner(false);
			view_set_show_count(0, true, true);
			break;
	}
	
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
	const evs = mode == VM_DM_THREAD ? 
		model_get_dm(model, opts.pubkey).events.concat().reverse() : 
		model_events_arr(model);
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
	let decrypted = false;
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

		// Skip non-renderables
		var ev = model.all_events[evid];
		if (!event_is_renderable(ev)) {
			continue;
		}

		// Re-render content of a decrypted dm
		if (ev.kind == KIND_DM && model.elements[evid]) {
			rerender_dm(model, ev, model.elements[evid]);
			decrypted = true;
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
		if (!latest_ev || mode == VM_DM_THREAD) {
			view_timeline_show_new(model);
		}
		if (mode == VM_DM_THREAD) {
			model_mark_dms_seen(model, opts.pubkey);
			view_dm_update(model);
		}
		view_set_show_count(count, true, false);
	}
	// Update notification markers and count
	if (ncount > 0) {
		//log_debug(`new notis ${ncount}`);
		model.notifications.count += ncount;
	}
	// Update the dms list view
	if (decrypted) {
		view_dm_update(model);
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
	if (mode == VM_DM_THREAD) decrypt_dms(model);
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
	const el = view_get_timeline_el();
	const p = model_get_profile(model, pubkey);
	const name = fmt_name(p);
	const pic = get_profile_pic(p);
	for (const evid in model.elements) {
		// Omitting this because we want to update profiles and names on all 
		// reactions
		//if (!event_contains_pubkey(model.all_events[evid], pubkey))
		//	continue;
		update_el_profile(model.elements[evid], pubkey, name, pic);	
	}
	// Update the profile view if it's active
	if (el.dataset.pubkey == pubkey) {
		const mode = el.dataset.mode;
		switch (mode) {
			case VM_USER:
				view_update_profile(model, pubkey);
			case VM_DM_THREAD:
				find_node("#view header > label").innerText = name;
		}
	}
	// Update dm's section since they are not in our view, dm's themselves will
	// be caught by the process above.
	update_el_profile(find_node("#dms"), pubkey, name, pic);
	update_el_profile(find_node("#view header"), pubkey, name, pic);
	update_el_profile(find_node("#newpost"), pubkey, name, pic);
}

function update_el_profile(el, pubkey, name, pic) {
	if (!el)
		return;
	find_nodes(`.username[data-pubkey='${pubkey}']`, el).forEach((el)=> {
		el.innerText = name;
	});
	find_nodes(`img[data-pubkey='${pubkey}']`, el).forEach((el)=> {
		el.src = pic;
		el.title = name;
	});
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
	if (mode != VM_DM_THREAD && ev.kind == KIND_DM) {
		return false;
	}
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
			return event_tags_pubkey(ev, model.pubkey);
		case VM_DM_THREAD:
			if (ev.kind != KIND_DM) return false;
			return (ev.pubkey == opts.pubkey && 
				event_tags_pubkey(ev, model.pubkey)) || 
				(ev.pubkey == model.pubkey &&
				event_tags_pubkey(ev, opts.pubkey));
	}
	return false;
}

function event_is_renderable(ev={}) {
	return ev.kind == KIND_NOTE || ev.kind == KIND_SHARE || ev.kind == KIND_DM;
}

function get_default_max_depth(damus, view) {
	return view.max_depth || damus.max_depth
}

function get_thread_max_depth(damus, view, root_id) {
	if (!view.depths[root_id])
		return get_default_max_depth(damus, view);
	return view.depths[root_id];
}

function get_thread_root_id(damus, id) {
	const ev = damus.all_events[id];
	if (!ev) {
		log_debug("expand_thread: no event found?", id)
		return null;
	}
	return ev.refs && ev.refs.root;
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

function html2el(html) {
	const div = document.createElement("div");
	div.innerHTML = html;
	return div.firstChild;
}

function init_my_pfp(model) {
	find_nodes(`img[role='my-pfp']`).forEach((el)=> {
		el.dataset.pubkey = model.pubkey;
		el.addEventListener("error", onerror_pfp);
		el.addEventListener("click", onclick_pfp);
		el.classList.add("clickable");
	});
	find_nodes(`img[role='their-pfp']`).forEach((el)=> {
		el.addEventListener("error", onerror_pfp);
		el.addEventListener("click", onclick_pfp);
		el.classList.add("clickable");
	});
}

function init_postbox(model) {
	const el = find_node("#newpost");
	find_node("textarea", el).addEventListener("input", oninput_post);
	find_node("button[role='send']").addEventListener("click", onclick_send);
	find_node("button[role='toggle-cw']")
		.addEventListener("click", onclick_toggle_cw);
	// Do reply box
	// TODO refactor & cleanup reply modal init 
	find_node("#reply-content").addEventListener("input", oninput_post);
	find_node("#reply-button").addEventListener("click", onclick_reply);
}
async function onclick_reply(ev) {
	// Temp method
	do_send_reply();
}
async function onclick_send(ev) {
	const el = view_get_timeline_el();
	const mode = el.dataset.mode;
	const pubkey = await get_pubkey();
	const el_input = document.querySelector("#post-input");
	const el_cw = document.querySelector("#content-warning-input");
	let post = {
		pubkey,
		kind: KIND_NOTE,
		created_at: new_creation_time(),
		content: el_input.value,
		tags: el_cw.value ? [["content-warning", el_cw.value]] : [],
	}

	// Handle DM type post
	if (mode == VM_DM_THREAD) {
		if (!dms_available()) {
			window.alert("DMing not available.");
			return;
		}
		post.kind = KIND_DM;
		const target = el.dataset.pubkey;
		post.tags.splice(0, 0, ["p", target]);
		post.content = await window.nostr.nip04.encrypt(target, post.content);
	}

	// Send it
	post.id = await nostrjs.calculate_id(post)
	post = await sign_event(post)
	broadcast_event(post);

	// Reset UI
	el_input.value = "";
	el_cw.value = "";
	trigger_postbox_assess(el_input);	
}
/* oninput_post checks the content of the textarea and updates the size
 * of it's element. Additionally I will toggle the enabled state of the sending
 * button.
 */
function oninput_post(ev) {
	trigger_postbox_assess(ev.target);
}
function trigger_postbox_assess(el) { 
	el.style.height = `0px`;
	el.style.height = `${el.scrollHeight}px`;
	let btn = el.parentElement.querySelector("button[role=send]");
	if (btn) btn.disabled = el.value === "";
}
/* toggle_cw changes the active stage of the Content Warning for a post. It is
 * relative to the element that is pressed.
 */
function onclick_toggle_cw(ev) {
	const el = ev.target;
	el.classList.toggle("active");
    const isOn = el.classList.contains("active");
	const input = el.parentElement.querySelector("input.cw");
	input.classList.toggle("hide", !isOn);
}
