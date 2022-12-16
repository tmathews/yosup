function load_events(damus) {
	if (!('event_cache' in localStorage))
		return {}
	const cached = JSON.parse(localStorage.getItem('event_cache'))

	return cached.reduce((obj, ev) => {
		obj[ev.id] = ev
		process_event(damus, ev)
		return obj
	}, {})
}

function load_cache(damus) {
	damus.all_events = load_events(damus)
	load_timelines(damus)
}

function save_cache(damus) {
	save_events(damus)
	save_timelines(damus)
}

function save_events(damus)
{
	const keys = Object.keys(damus.all_events)
	const MAX_KINDS = {
		1: 2000,
		0: 2000,

		6: 100,
		4: 100,
		5: 100,
		7: 100,
	}

	let counts = {}

	let cached = keys.map((key) => {
		const ev = damus.all_events[key]
		const {sig, pubkey, content, tags, kind, created_at, id} = ev
		return {sig, pubkey, content, tags, kind, created_at, id}
	})

	cached.sort((a,b) => b.created_at - a.created_at)
	cached = cached.reduce((cs, ev) => {
		counts[ev.kind] = (counts[ev.kind] || 0)+1
		if (counts[ev.kind] < MAX_KINDS[ev.kind])
			cs.push(ev)
		return cs
	}, [])

	log_debug('saving all events to local storage', cached.length)

	localStorage.setItem('event_cache', JSON.stringify(cached))
}

function save_timelines(damus)
{
	const views = Object.keys(damus.views).reduce((obj, view_name) => {
		const view = damus.views[view_name]
		obj[view_name] = view.events.map(e => e.id).slice(0,100)
		return obj
	}, {})
	localStorage.setItem('views', JSON.stringify(views))
}

function load_timelines(damus)
{
	if (!('views' in localStorage))
		return
	const stored_views = JSON.parse(localStorage.getItem('views'))
	for (const view_name of Object.keys(damus.views)) {
		const view = damus.views[view_name]
		view.events = (stored_views[view_name] || []).reduce((evs, evid) => {
			const ev = damus.all_events[evid]
			if (ev) evs.push(ev)
			return evs
		}, [])
	}
}

function schedule_save_events(damus)
{
	if (damus.save_timer)
		clearTimeout(damus.save_timer)
	damus.save_timer = setTimeout(save_cache.bind(null, damus), 3000)
}


