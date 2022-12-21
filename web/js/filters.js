function filters_subscribe(filters, pool, relays=undefined) {
	for (const key in filters) {
		pool.subscribe(key, filters[key], relays);
	}
}

function filters_new_default(model) {
	const { pubkey, ids, contacts } = model;
	const friends = Array.from(contacts);	
	friends.push(pubkey);
	const f = {};
	f[ids.home] = filters_new_friends(friends);
	//f[ids.home] = [{authors: [pubkey], kinds: STANDARD_KINDS}];
	f[ids.contacts] = filters_new_contacts(friends);
	f[ids.dms] = filters_new_dms(pubkey);
	f[ids.notifications] = filters_new_notifications(pubkey);
	f[ids.explore] = [{kinds: STANDARD_KINDS, limit: 500}];
	return f;
}

function filters_new_default_since(model, cache) {
	const filters = filters_new_default(model);
	for (const key in filters) {
		filters[key] = filters_set_since(filters[key], cache);
	}
	return filters;
}

function filter_new_initial(pubkey) {
	return {
		authors: [pubkey],
		kinds: [KIND_CONTACT],
		limit: 1,
	};
}

function filters_new_contacts(friends) {
	return [{
		kinds: [KIND_METADATA],
		authors: friends,
	}]
}

function filters_new_dms(pubkey, limit=100) {
	return [
	{ // dms we sent
		kinds: [KIND_DM],
		limit,
		authors: [pubkey],
	}, { // replys to us
		kinds: [KIND_DM],
		limit: limit,
		"#p":  [pubkey],
	}]
}

function filters_new_friends(friends, limit=500) {
	return [{
		kinds: STANDARD_KINDS,
		authors: friends,
		limit,
	}]
}

function filters_new_notifications(pubkey, limit=100) {
	return [{
		kinds: STANDARD_KINDS,
		"#p": [pubkey],
		limit,
	}]
}

function filters_set_since(filters=[], cache={}) {
	filters.forEach((filter) => {
		const since = get_earliest_since_time(filter.kinds, cache)
		delete filter.since;
		if (since) filter.since = since;
	});
	return filters
}

function get_earliest_since_time(kinds=[], cache={}) {
	const earliest = kinds.reduce((a, kind) => {
		const b = get_since_time(cache[kind]);
		if (!a) {
			return b;
		}
		return b < a ? b : a;
	}, undefined);
	return earliest;
}

/* calculate_last_of_kind returns a map of kinds to time, where time is the 
 * last time it saw that kind.
 */
function calculate_last_of_kind(evs) {
	const now_sec = new Date().getTime() / 1000
	return Object.keys(evs).reduce((obj, evid) => {
		const ev = evs[evid]
		if (!is_valid_time(now_sec, ev.created_at))
			return obj
		const prev = obj[ev.kind] || 0
		obj[ev.kind] = get_since_time(max(ev.created_at, prev))
		return obj
	}, {})
}

