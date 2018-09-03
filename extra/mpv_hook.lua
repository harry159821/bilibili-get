local msg = require 'mp.msg'
local utils = require 'mp.utils'
local options = require 'mp.options'

local o = {
    exclude = "",
    try_ytdl_first = false,
    use_manifests = false
}

options.read_options(o)

local bget = {
    path = "bilibili-get",
    searched = false
}

function Set (t)
    local set = {}
    for _, v in pairs(t) do set[v] = true end
    return set
end

local safe_protos = Set {
    "http", "https", "ftp", "ftps",
    "rtmp", "rtmps", "rtmpe", "rtmpt", "rtmpts", "rtmpte",
    "data"
}

local function exec(args)
    local ret = utils.subprocess({args = args})
    return ret.status, ret.stdout, ret
end

-- return true if it was explicitly set on the command line
local function option_was_set(name)
    return mp.get_property_bool("option-info/" ..name.. "/set-from-commandline",
                                false)
end

-- youtube-dl may set special http headers for some sites (user-agent, cookies)
local function set_http_headers(http_headers)
    if not http_headers then
        return
    end
    local headers = {}
    local useragent = http_headers["User-Agent"]
    if useragent and not option_was_set("user-agent") then
        mp.set_property("file-local-options/user-agent", useragent)
    end
    local additional_fields = {"Cookie", "Referer", "X-Forwarded-For"}
    for idx, item in pairs(additional_fields) do
        local field_value = http_headers[item]
        if field_value then
            headers[#headers + 1] = item .. ": " .. field_value
        end
    end
    if #headers > 0 and not option_was_set("http-header-fields") then
        mp.set_property_native("file-local-options/http-header-fields", headers)
    end
end

local function append_libav_opt(props, name, value)
    if not props then
        props = {}
    end

    if name and value and not props[name] then
        props[name] = value
    end

    return props
end

local function edl_escape(url)
    return "%" .. string.len(url) .. "%" .. url
end

local function url_is_safe(url)
    local proto = type(url) == "string" and url:match("^(.+)://") or nil
    local safe = proto and safe_protos[proto]
    if not safe then
        msg.error(("Ignoring potentially unsafe url: '%s'"):format(url))
    end
    return safe
end

local function edl_track_joined(fragments)
    if not (type(fragments) == "table") or not fragments[1] then
        msg.debug("No fragments to join into EDL")
        return nil
    end

    local edl = "edl://"
    local offset = 1
    local parts = {}

    for i = offset, #fragments do
        local fragment = fragments[i]
        table.insert(parts, edl_escape(fragment))
        if fragment.duration then
            parts[#parts] =
                parts[#parts] .. ",length=" .. (fragment.duration / 1000)
        end
    end
    return edl .. table.concat(parts, ";") .. ";"
end

local function add_single_video(json)
    local streamurl = ""

    if not (json.url == nil) then
        local edl_track = nil
        edl_track = edl_track_joined(json.fragments, json.protocol,
            json.is_live, json.fragment_base_url)

        if not edl_track and not url_is_safe(json.url) then
            return
        end
        -- normal video or single track
        streamurl = edl_track or json.url
        set_http_headers(json.http_headers)
    else
        msg.error("No URL found in JSON data.")
        return
    end

    msg.debug("streamurl: " .. streamurl)

    mp.set_property("stream-open-filename", streamurl:gsub("^data:", "data://", 1))

    mp.set_property("file-local-options/force-media-title", json.title)

    local stream_opts = mp.get_property_native("file-local-options/stream-lavf-o", {})

    if json.proxy and json.proxy ~= "" then
        stream_opts = append_libav_opt(stream_opts,
            "http_proxy", json.proxy)
    end

    mp.set_property_native("file-local-options/stream-lavf-o", stream_opts)
end

mp.add_hook(o.try_ytdl_first and "on_load" or "on_load_fail", 10, function ()
    local url = mp.get_property("stream-open-filename", "")
    if not (url:find("bilibili://") == 1) and
        not ((url:find("https?://") == 1) and not is_blacklisted(url)) then
        return
    end
    local start_time = os.clock()

    -- check for youtube-dl in mpv's config dir
    if not (bget.searched) then
        local exesuf = (package.config:sub(1,1) == '\\') and '.exe' or ''
        local bget_mcd = mp.find_config_file("bilibili-get" .. exesuf)
        if not (bget_mcd == nil) then
            msg.verbose("found bilibili-get at: " .. bget_mcd)
            bget.path = bget_mcd
        end
        bget.searched = true
    end

    -- strip bilibili://
    if (url:find("bilibili://") == 1) then
        url = url:sub(12)
    end

    local command = { bget.path }
    local quality = mp.get_property("options/bget-quality")
    local cookie = mp.get_property("options/bget-cookie")
    local raw_options = mp.get_property_native("options/bget-raw-options")

    if (quality == "") then
        quality = "112"
    end

    table.insert(command, "--quality")
    table.insert(command, quality)

    if (cookie ~= "") then
        table.insert(command, "--cookie")
        table.insert(command, cookie)
    end

    for param, arg in pairs(raw_options) do
        table.insert(command, "--" .. param)
        if (arg ~= "") then
            table.insert(command, arg)
        end
    end

    table.insert(command, url)

    msg.debug("Running: " .. table.concat(command,' '))
    local es, json, result = exec(command)

    if (es < 0) or (json == nil) or (json == "") then
        local err = "bilibili-get failed: "
        if result.error and result.error == "init" then
            err = err .. "not found or not enough permissions"
        elseif not result.killed_by_us then
            err = err .. "unexpected error ocurred"
        else
            err = string.format("%s returned '%d'", err, es)
        end
        msg.error(err)
        return
    end

    local json, err = utils.parse_json(json)

    if (json == nil) then
        msg.error("failed to parse JSON data: " .. err)
        return
    end

    msg.verbose("bilibili-get succeeded!")
    msg.debug('bilibili parsing took '..os.clock()-start_time..' seconds')

    if json.durl then
        -- a video
        add_single_video(json)
    else
        -- a playlist
        local playlist_index = parse_yt_playlist(url, json)
        local playlist = {"#EXTM3U"}
        for i, entry in pairs(json.entries) do
            local site = entry.url
            local title = entry.title

            if not (title == nil) then
                title = string.gsub(title, '%s+', ' ')
                table.insert(playlist, "#EXTINF:0," .. title)
            end

            --[[ some extractors will still return the full info for
            all clips in the playlist and the URL will point
            directly to the file in that case, which we don't
            want so get the webpage URL instead, which is what
            we want, but only if we aren't going to trigger an
            infinite loop
            --]]
            if entry["webpage_url"] and not self_redirecting_url then
                site = entry["webpage_url"]
            end

            -- links without protocol as returned by --flat-playlist
            if not site:find("://") then
                -- youtube extractor provides only IDs,
                -- others come prefixed with the extractor name and ":"
                local prefix = site:find(":") and "ytdl://" or
                "https://youtu.be/"
                table.insert(playlist, prefix .. site)
            elseif url_is_safe(site) then
                table.insert(playlist, site)
            end
        end

        if not option_was_set("playlist-start") and playlist_index then
            mp.set_property_number("playlist-start", playlist_index)
        end
        mp.set_property("stream-open-filename", "memory://" .. table.concat(playlist, "\n"))
    end
    msg.debug('script running time: '..os.clock()-start_time..' seconds')
end)
