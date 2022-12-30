// This file contains all methods related to rendering UI elements. Rendering
// is done by simple string manipulations & templates. If you need to write
// loops simply write it in code and return strings.

function render_replying_to(model, ev) {
	if (!(ev.refs && ev.refs.reply))
		return "";
	let pubkeys = ev.refs.pubkeys || []
	if (pubkeys.length === 0 && ev.refs.reply) {
		const replying_to = model.all_events[ev.refs.reply]
		// If there is no profile being replied to, it is simply a reply to an 
		// event itself, thus render it differently.
		if (!replying_to) {
			return html`<span class="replying-to small-txt">
				replying in thread 
				<span class="thread-id clickable" 
				onclick="open_thread('${ev.refs.reply}')">
				${fmt_pubkey(ev.refs.reply)}</span></span>`;
		} else {
			pubkeys = [replying_to.pubkey];
		}
	}
	const names = pubkeys.map((pk) => {
		return render_name(pk, model_get_profile(model, pk).data);
	}).join(", ")
	return `
	<span class="replying-to small-txt">
		replying to ${names}
	</span>
	`
}

function render_share(model, ev, opts) {
	const shared_ev = model.all_events[ev.refs && ev.refs.root]
	// If the shared event hasn't been resolved or leads to a circular event 
	// kind we will skip out on it.
	if (!shared_ev || shared_ev.kind == KIND_SHARE)
		return "";
	opts.shared = {
		pubkey: ev.pubkey,
		profile: model_get_profile(model, ev.pubkey),
		share_time: ev.created_at,
		share_evid: ev.id,
	}
	return render_event(model, shared_ev, opts)
}

function render_shared_by(ev, opts) {
	if (!opts.shared)
		return "";
	const { profile, pubkey } = opts.shared
	return `<div class="shared-by">Shared by ${render_name(pubkey, profile)}
		</div>`
}

function render_event(model, ev, opts={}) {
	if (ev.kind == KIND_SHARE) {
		return render_share(model, ev, opts);
	}

	const profile = model_get_profile(model, ev.pubkey);
	const delta = fmt_since_str(new Date().getTime(), ev.created_at*1000)
	const border_bottom = opts.is_composing ? "" : "bottom-border";
	let thread_btn = "";
	return html`<div id="ev${ev.id}" class="event ${border_bottom}">
		<div class="userpic">
			$${render_pfp(ev.pubkey, profile.data)}
		</div>	
		<div class="event-content">
			<div class="info">
				$${render_name(ev.pubkey, profile.data)}
				<span class="timestamp" data-timestamp="${ev.created_at}">${delta}</span>
			</div>
			<div class="comment">
				$${render_event_body(model, ev, opts)}
			</div>
		</div>
	</div>` 
}

function render_event_nointeract(model, ev, opts={}) {
	const profile = model_get_profile(model, ev.pubkey);
	const delta = fmt_since_str(new Date().getTime(), ev.created_at*1000)
	return html`<div class="event border-bottom">
		<div class="userpic">
			$${render_pfp(ev.pubkey, profile.data)}
		</div>	
		<div class="event-content">
			<div class="info">
				$${render_name(ev.pubkey, profile.data)}
				<span class="timestamp" data-timestamp="${ev.created_at}">${delta}</span>
			</div>
			<div class="comment">
				$${render_event_body(model, ev, opts)}
			</div>
		</div>
	</div>`
}

function render_event_body(model, ev, opts) {
	const { shared } = opts;
	const can_delete = model.pubkey === ev.pubkey || 
		(opts.shared && model.pubkey == opts.shared.pubkey);
	// Only show media for content that is by friends.
	let show_media = true;
	if (opts.is_composing) {
		show_media = false;
	} else if (model.embeds == "friends") {
		show_media = model.contacts.friends.has(ev.pubkey);
	}
	let str = "<div>";
	str += shared ? render_shared_by(ev, opts) : render_replying_to(model, ev);
	str += `</div><p>
	${format_content(ev, show_media)}
	</p>`;
	str += render_reactions(model, ev);
	str += opts.nobar ? "" : 
		render_action_bar(model, ev, {can_delete, shared});
	return str;
}

function render_react_onclick(our_pubkey, reacting_to, emoji, reactions) {
	const reaction = reactions[our_pubkey]
	if (!reaction) {
		return html`onclick="send_reply('${emoji}', '${reacting_to}')"`
	} else {
		return html`onclick="delete_post('${reaction.id}')"`
	}
}

function render_reaction_group(model, emoji, reactions, reacting_to) {
	let count = 0;
	let str = "";
	for (const k in reactions) {
		count++;
		if (count > 5)
			continue;
		const pubkey = reactions[k].pubkey;
		str += render_pfp(pubkey, model_get_profile(model, pubkey).data, 
			{noclick:true});
	}
	if (count > 5)
		str = `${count}`;
	let onclick = render_react_onclick(model.pubkey, 
		reacting_to.id, emoji, reactions);
	return html`
	<span $${onclick} class="reaction-group clickable">
		<span class="reaction-emoji">
		${emoji}
		</span>
		$${str}
	</span>`;
}

function render_action_bar(model, ev, opts={}) {
	const { pubkey } = model;
	let { can_delete, shared } = opts;
	// TODO rewrite all of the toggle heart code. It's mine & I hate it.
	const thread_root = (ev.refs && ev.refs.root) || ev.id;
	const reaction = model_get_reacts_to(model, pubkey, ev.id, R_HEART);
	const liked = !!reaction;
	const reaction_id = reaction ? reaction.id : "";
	let str = html`<div class="action-bar">`;
	if (!shared && event_can_reply(ev)) {
		str += html`<button class="icon" title="Reply" onclick="reply_author('${ev.id}')">
			<img class="icon svg small" src="icon/event-reply.svg"/>
		</button>
		<button class="icon" title="Reply All" onclick="reply_all('${ev.id}')">
			<img class="icon svg small" src="icon/event-reply-all.svg"/>
		</button>
		<button class="icon react heart ${ab(liked, 'liked', '')}" 
			onclick="click_toggle_like(this)"
			data-reaction-id="${reaction_id}"
			data-reacting-to="${ev.id}"
			title="$${ab(liked, 'Unlike', 'Like')}">
			<img class="icon svg small ${ab(liked, 'dark-noinvert', '')}" 
				src="$${ab(liked, IMG_EVENT_LIKED, IMG_EVENT_LIKE)}"/>
		</button>`;
	}
	if (!shared) {
		str += html`<button class="icon" title="Share" data-evid="${ev.id}" onclick="click_share(this)">
			<img class="icon svg small" src="icon/event-share.svg"/>
		</button>`;
	}
	str += `
	<button class="icon" title="View Thread" role="view-event" 
	onclick="open_thread('${thread_root}')">
		<img class="icon svg small" src="icon/open-thread.svg"/>
	</button>
	<button class="icon" title="View Replies" role="view-event" 
	onclick="open_thread('${ev.id}')">
		<img class="icon svg small" src="icon/open-thread-here.svg"/>
	</button>`;
	if (can_delete) {
		const delete_id = shared ? shared.share_evid : ev.id;
		str += html`
	<button class="icon" title="Delete" onclick="delete_post_confirm('${delete_id}')">
		<img class="icon svg small" src="icon/event-delete.svg"/>
	</button>` 
	}
	return str + "</div>";
}

function render_reactions_inner(model, ev) {
	const groups = get_reactions(model, ev.id)
	let str = ""
	for (const emoji of Object.keys(groups)) {
		str += render_reaction_group(model, emoji, groups[emoji], ev)
	}
	return str;
}

function render_reactions(model, ev) {
	return html`<div class="reactions">$${render_reactions_inner(model, ev)}</div>`
}

// Utility Methods

function render_pubkey(pk) {
	return fmt_pubkey(pk);
}

function render_username(pk, profile)
{
	return (profile && profile.name) || render_pubkey(pk)
}

function render_mentioned_name(pk, profile) {
	return render_name(pk, profile, "");
}

function render_name(pk, profile, prefix="") {
	// Beware of whitespace.
	return html`<span>${prefix}<span class="username clickable" data-pubkey="${pk}" 
		onclick="open_profile('${pk}')"
		>${fmt_profile_name(profile, fmt_pubkey(pk))}</span></span>`
}

function render_pfp(pk, profile, opts={}) {
	const name = fmt_profile_name(profile, fmt_pubkey(pk));
	let str = html`class="pfp clickable" onclick="open_profile('${pk}')"`;
	if (opts.noclick)
		str = "class='pfp'";
	return html`<img 
	$${str}
	data-pubkey="${pk}" 
	title="${name}" 
	onerror="this.onerror=null;this.src='${IMG_NO_USER}';" 
	src="${get_picture(pk, profile)}"/>`
}

