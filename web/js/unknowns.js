function make_unk(hint, ev) {
	const attempts = 0
	const parent_created = ev.created_at
	if (hint && hint !== "")
		return {attempts, hint: hint.trim().toLowerCase(), parent_created}
	return {attempts, parent_created}
}

function gather_unknown_hints(damus, pks, evids)
{
	let relays = new Set()
	for (const pk of pks) {
		const unk = damus.unknown_pks[pk]
		if (unk && unk.hint && unk.hint !== "")
			relays.add(unk.hint)
	}
	for (const evid of evids) {
		const unk = damus.unknown_ids[evid]
		if (unk && unk.hint && unk.hint !== "")
			relays.add(unk.hint)
	}
	return Array.from(relays)
}

function get_non_expired_unknowns(unks, type)
{
	const MAX_ATTEMPTS = 2

	function sort_parent_created(a_id, b_id) {
		const a = unks[a_id]
		const b = unks[b_id]
		return b.parent_created - a.parent_created
	}

	let new_expired = 0
	const ids = Object.keys(unks).sort(sort_parent_created).reduce((ids, unk_id) => {
		if (ids.length >= 255)
			return ids

		const unk = unks[unk_id]
		if (unk.attempts >= MAX_ATTEMPTS) {
			if (!unk.expired) {
				unk.expired = true
				new_expired++
			}
			return ids
		}

		unk.attempts++

		ids.push(unk_id)
		return ids
	}, [])

	if (new_expired !== 0)
		log_debug("Gave up looking for %d %s", new_expired, type)

	return ids
}

function fetch_unknown_events(damus)
{
	let filters = []
	const pks = get_non_expired_unknowns(damus.unknown_pks, 'profiles')
	const evids = get_non_expired_unknowns(damus.unknown_ids, 'events')
	const relays = gather_unknown_hints(damus, pks, evids)
	for (const relay of relays) {
		if (!damus.pool.has(relay)) {
			log_debug("adding %s to relays to fetch unknown events", relay)
			damus.pool.add(relay)
		}
	}
	if (evids.length !== 0) {
		const unk_kinds = [1,5,6,7,40,42] // TODO don't hardcode event kinds
		filters.push({ids: evids, kinds: unk_kinds})
		filters.push({"#e": evids, kinds: [1,42], limit: 100})
	}
	if (pks.length !== 0)
		filters.push({authors: pks, kinds:[0]})
	if (filters.length === 0)
		return
	log_debug("fetching unknowns", filters)
	damus.pool.subscribe('unknowns', filters)
}

function schedule_unknown_refetch(damus)
{
	const INTERVAL = 5000
	if (!damus.unknown_timer) {
		log_debug("fetching unknown events now and in %d seconds", INTERVAL / 1000)
		damus.unknown_timer = setTimeout(() => {
			fetch_unknown_events(damus)

			setTimeout(() => {
				delete damus.unknown_timer
				if (damus.but_wait_theres_more > 0) {
					damus.but_wait_theres_more = 0
					schedule_unknown_refetch(damus)
				}
			}, INTERVAL)
		}, INTERVAL)
		fetch_unknown_events(damus)
	} else {
		damus.but_wait_theres_more++
	}
}

