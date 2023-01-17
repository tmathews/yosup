function linkify(text="", show_media=false) {
	return text.replace(URL_REGEX, function(match, p1, p2, p3) {
		const url = p2+p3;
		let parsed;
		try {
			parsed = new URL(url)
		} catch (err) {
			return match;
		}
		let markup;
		if (show_media && is_img_url(parsed.pathname)) {
			markup = html`
			<img class="inline-img clickable" src="${url}" 
			onclick="open_media_preview('${url}', 'image')"/>`;
		} else if (show_media && is_video_url(parsed.pathname)) {
			markup = html`
			<video controls class="inline-img" />
			  <source src="${url}">
			</video>`;
		} else {
			markup = html`<a target="_blank" rel="noopener noreferrer" href="${url}">${url}</a>`;
		}
		return p1+markup;
	})
}

function format_content(model, ev, show_media) {
	if (ev.kind === KIND_REACTION) {
		if (ev.content === "" || ev.content === "+")
			return "❤️"
		return html`${ev.content.trim()}`;
	}
	const content = (ev.kind == KIND_DM ? ev.decrypted || ev.content : ev.content)
		.trim();
	const body = fmt_mentions(model, fmt_body(content, show_media), 
		event_get_tagged_pubkeys(ev));
	let cw = get_content_warning(ev.tags)
	if (cw !== null) {
		let cwHTML = "Content Warning"
		if (cw === "") {
			cwHTML += "."
		} else {
			cwHTML += html`: "<span>${cw}</span>".`
		}
		return `
		<details class="cw">
		  <summary class="event-message">${cwHTML}</summary>
		  ${body}
		</details>`;
	}
	return body;
}

function fmt_mentions(model, str, pubkeys) {
	var buf = "";
	for (var i = 0; i < str.length; i++) {
		let c = str.charAt(i);
		let peek = str.charAt(i+1);
		if (!(c == "#" && peek == "[")) {
			buf += c;
			continue;
		}
		const start = i;
		i += 2;
		let x = "";
		for(;;) {
			c = str.charAt(i);
			if (c >= '0' && c <= '9') {
				x += c;
				i++;
			} else if (c == ']') {
				break;	
			} else {
				buf += x;
				x = "";
				break;
			}
		}
		if (x == "")
			continue;
		// Specification says it's 0-based, but everyone is doing 1-base
		let pubkey = pubkeys[parseInt(x)];
		if (!pubkey) {
			buf += "(Invalid User Mentioned)"
			continue;
		}
		let profile = model_get_profile(model, pubkey);
		buf += `<span class="username clickable" data-pubkey="${pubkey}">
			${fmt_name(profile)}</span>`;
	}
	return buf;
}

/* fmt_body will parse images, blockquotes, and sanitize the content.
 */
function fmt_body(content, show_media) {
	const split = content.split("\n")
	let blockin = false
	return split.reduce((str, line) => {
		if (line !== "" && line[0] === '>') {
			if (!blockin) {
				str += "<span class='quote'>"
				blockin = true
			}
			str += linkify(html`${line.slice(1)}`, show_media)
		} else {
			if (blockin) {
				blockin = false
				str += "</span>"
			}
			str += linkify(html`${line}`, show_media)
		}
		return str + "<br/>"
	}, "")
}

/* DEPRECATED: use fmt_name
 * format_profile_name takes in a profile and tries it's best to
 * return a string that is best suited for the profile. 
 */
function fmt_profile_name(profile={}, fallback="Anonymous") {
	const name = profile.display_name || profile.user || profile.name || 
		fallback	
	return html`${name}`;
}

function fmt_name(profile={data:{}}) {
	const { data } = profile;
	const name = data.display_name || data.user || data.name || 
		fmt_pubkey(profile.pubkey);
	return html`${name}`;
}

function fmt_pubkey(pk) {
	if (!pk)
		return "Unknown";
	return pk.slice(-8)
}

function fmt_datetime(d) {
	return d.getFullYear() + 
		"/" + ("0" + (d.getMonth()+1)).slice(-2) + 
		"/" + ("0" + d.getDate()).slice(-2) + 
		" " + ("0" + d.getHours()).slice(-2) + 
		":" + ("0" + d.getMinutes()).slice(-2);
}
