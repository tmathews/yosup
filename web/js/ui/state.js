function get_view_el(name) {
	return DAMUS.view_el.querySelector(`#${name}-view`)
}

function get_default_max_depth(damus, view) {
	return view.max_depth || damus.max_depth
}

function get_thread_max_depth(damus, view, root_id) {
	if (!view.depths[root_id])
		return get_default_max_depth(damus, view)

	return view.depths[root_id]
}

function shouldnt_render_event(our_pk, view, ev, opts) {
	return !opts.is_composing &&
		!view.expanded.has(ev.id) &&
		view.rendered.has(ev.id)
}

function toggle_content_warning(el) {
	const id = el.id.split("_")[1]
	const ev = DAMUS.all_events[id]

	if (!ev) {
		log_debug("could not find content-warning event", id)
		return
	}

	DAMUS.cw_open[id] = el.open
}

function expand_thread(id, reply_id) {
	const view = get_current_view()
	const root_id = get_thread_root_id(DAMUS, id)
	if (!root_id) {
		log_debug("could not get root_id for", DAMUS.all_events[id])
		return
	}
	view.expanded.add(reply_id)
	view.depths[root_id] = get_thread_max_depth(DAMUS, view, root_id) + 1
	redraw_events(DAMUS, view)
}

function get_thread_root_id(damus, id) {
	const ev = damus.all_events[id]
	if (!ev) {
		log_debug("expand_thread: no event found?", id)
		return null
	}
	return ev.refs && ev.refs.root
}

function redraw_events(damus, view) {
	//log_debug("redrawing events for", view)
	view.rendered = new Set()
	const events_el = damus.view_el.querySelector(`#${view.name}-view > .events`)
	events_el.innerHTML = render_events(damus, view)
}

function redraw_timeline_events(damus, name) {
	const view = DAMUS.views[name]
	const events_el = damus.view_el.querySelector(`#${name}-view > .events`)
	if (view.events.length > 0) {
		redraw_events(damus, view)
	} else {
		events_el.innerHTML = render_loading_spinner()
	}
}

function switch_view(name, opts={})
{
	if (name === DAMUS.current_view) {
		log_debug("Not switching to '%s', we are already there", name)
		return
	}

	const last = get_current_view()
	if (!last) {
		// render initial
		DAMUS.current_view = name
		redraw_timeline_events(DAMUS, name)
		return
	}

	log_debug("switching to '%s' by hiding '%s'", name, DAMUS.current_view)

	DAMUS.current_view = name
	const current = get_current_view()
	const last_el = get_view_el(last.name)
	const current_el = get_view_el(current.name)

	if (last_el)
		last_el.classList.add("hide");

	// TODO accomodate views that do not render events
	// TODO find out if having multiple event divs is slow
	//redraw_timeline_events(DAMUS, name)

	find_node("#nav > div[data-active]").dataset.active = name;

	if (current_el)
		current_el.classList.remove("hide");
}

function get_current_view()
{
	// TODO resolve memory & html descriptencies
	// Currently there is tracking of which divs are visible in HTML/CSS and
	// which is active in memory, simply resolve this by finding the visible
	// element instead of tracking it in memory (or remove dom elements). This
	// would simplify state tracking IMO - Thomas
	return DAMUS.views[DAMUS.current_view]
}

function view_timeline_update_profiles(model, state, ev) {
	let xs, html;
	const el = find_node("#view #home-view .events");
	const pk = ev.pubkey;
	const p = model.profiles[pk];

	// If it's my pubkey let's redraw my pfp that is not located in the view
	if (pk == model.pubkey) {
		redraw_my_pfp(model);
	}

	// Update displayed names
	xs = el.querySelectorAll(`.username[data-pubkey='${pk}']`)
	html = render_name_plain(p);
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

function view_timeline_update(model, state) {
	const el = find_node("#view #home-view .events");

	// for each event not rendered, go through the list and render it marking 
	// it as rendered and adding it to the appropriate fragment. fragments are
	// created based on slices in the existing timeline. fragments are started
	// at the previous event
	// const fragments = {};
	// const cache = {};

	// Dumb function to insert needed events
	const all = model_events_arr(model);
	while (state.invalidated.length > 0) {
		var evid = state.invalidated.pop();
		var ev = model.all_events[evid];
		if (!event_is_renderable(ev)) {
			// TODO check deleted
			let x = find_node("#ev"+evid, el);
			if (x) el.removeChild(x);
			continue;
		}

		// TODO if event is not viewable for page, simply hide it

		// if event is in el already, do nothing or update?
		let ev_el = find_node("#ev"+evid, el);
		if (ev_el) {
			continue;
		} else {
			let div = document.createElement("div");
			div.innerHTML = render_event2(model, ev, {});
			ev_el = div.firstChild;
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
}

function event_is_renderable(ev={}) {
	if (ev.is_spam) return false;
	if (ev.kind != 1) return false;
	return true;
}

