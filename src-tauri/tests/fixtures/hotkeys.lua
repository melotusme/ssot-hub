-- 应用快捷键配置
local app_shortcuts = {
    -- IDE 类应用
    ide = {
        --{ key = "A", app = "/Users/example/Applications/AppCode.app" },
        { key = "E", app = "/Users/example/Applications/IntelliJ IDEA.app" },
        { key = "I", app = "/Applications/OpenCode.app" },
        { key = "P", app = "/Applications/Microsoft PowerPoint.app" },
        { key = "R", app = "/Applications/Firefox.app/" },
        --{ key = "S", app = "/Applications/Cursor.app" },
        --{ key = "S", app = "/System/Applications/Utilities/Screen Sharing.app" },
        { key = "S", app = "/Applications/Shadowrocket.app" },
        { key = "M", app = "/System/Applications/iPhone Mirroring.app" },
        { key = "V", app = "/Applications/Visual Studio Code.app" },
        --{ key = "W", app = "/Applications/wpsoffice.app" },
        { key = "W", app = "/Applications/WeChat.app" },
        { key = "X", app = "/Applications/Orca.app",},
        { key = "X",mods = { "cmd", "ctrl", "shift" }, app = "/Applications/ChatGPT.app", bundleID = "com.openai.codex", cockpitManagedCodex = true,  },
        { key = "Z", app = "/Applications/Zed.app" },
        { key = "B", app = "/Applications/Grok Bot.app" },
    },

    -- 开发工具
    tools = {
        --{ key = "C", app = "/Applications/Google Chrome.app", bundleID = "com.google.Chrome" },
        { key = "C", app = "/Applications/ego lite.app", bundleID = "com.citrolabs.ego.lite" },
        { key = "C", mods = {"cmd","ctrl","shift"}, app = "/Applications/Google Chrome.app", bundleID = "com.google.Chrome" },
        --[[{]]
            --[[mods = { "cmd", "ctrl", "shift" },]]
            --[[key = "C",]]
            --[[app = "/Applications/Google Chrome.app",]]
            --[[bundleID = "com.google.Chrome",]]
            --[[userDataDir = os.getenv("HOME") .. "/.chrome-hammerspoon-remote-debug",]]
            --[[remoteDebuggingPort = 9222,]]
            --[[launchNewInstance = true,]]
            --[[launchArgs = {]]
                --[["--remote-debugging-address=0.0.0.0",]]
                --[["--remote-debugging-port=9222",]]
                --[["--user-data-dir=" .. os.getenv("HOME") .. "/.chrome-hammerspoon-remote-debug",]]
            --[[},]]
        --[[},]]
        --{ mods = { "cmd", "ctrl" }, key = "B", app = "/Applications/ChatGPT.app" },
        { key = "G", app = "/Applications/Gemini.app" },
        { key = "G", mods = { "cmd", "ctrl", "shift" }, app = "/Applications/Antigravity.app" },
        { key = "A", app = "/Applications/Claude.app" },
        { key = "O", app = "/Applications/Obsidian.app" },
        --{ key = "T", app = "/Applications/Ghostty.app" },
        { key = "T", app = "/Applications/Wave.app" },
        { key = "T", mods = { "cmd", "ctrl", "shift" }, app = "/Applications/iTerm.app" },

    },

    -- 游戏开发
    gamedev = {
        -- { key = "2", app = "/Users/example/Applications/Rider.app" },
        -- { key = "3", app = "/Applications/Unity/Hub/Editor/6000.0.30f1/Unity.app/" },
        -- { key = "4", app = "/Applications/Godot_mono.app" },
        --{ key = "B", app = "/Applications/Blender.app" },
    },

    -- 其他应用
    others = {
        { key = "Y", app = "/Applications/有道云笔记.app" },
        -- ⌃⌘D：系统默认是「查词/Dictionary Lookup」，已用 Hammerspoon 抢占
        -- 若仍弹出系统词典：系统设置 → 键盘 → 键盘快捷键 → 服务 → 搜索，关掉「在词典中查询」
        -- 或用 Karabiner 屏蔽；多数情况下 hs.hotkey 会优先生效
        --{ key = "D", app = "/Applications/Open Design.app" },
        { key = "D", app = "/Applications/DeepSeek Harness.app" },
        { mods = { "option" }, key = "F", app = "/System/Library/CoreServices/Finder.app" },
        --{ mods = { "option" }, key = "G", app = "/Applications/Antigravity.app" },
    }
}

local function launch_with_args(app, args, new_instance)
    local launch_args = {}
    if new_instance then
        table.insert(launch_args, "-n")
    end

    table.insert(launch_args, "-a")
    table.insert(launch_args, app)
    table.insert(launch_args, "--args")

    for _, arg in ipairs(args) do
        table.insert(launch_args, arg)
    end

    local task = hs.task.new("/usr/bin/open", nil, launch_args)

    if not task then
        return false
    end

    task:start()
    return true
end

local function find_available_local_port(first_port, last_port)
    for port = first_port, last_port do
        local command = string.format(
            "/usr/sbin/lsof -nP -iTCP:%d -sTCP:LISTEN -t 2>/dev/null",
            port
        )
        local output = hs.execute(command)
        if not output or output:match("^%s*$") then
            return port
        end
    end
    return nil
end

local function launch_cockpit_managed_codex(item)
    local running = hs.application.applicationsForBundleID(item.bundleID)
    if running and #running > 0 then
        running[1]:activate()
        return
    end

    local function launch_codex()
        local port = find_available_local_port(59442, 59542)
        if not port then
            hs.alert.show("没有可用的 Codex 调试端口")
            return
        end

        launch_with_args(item.app, {
            "--remote-debugging-address=127.0.0.1",
            "--remote-debugging-port=" .. tostring(port),
        }, false)
    end

    local cockpit = hs.application.applicationsForBundleID("com.jlcodes.cockpit-tools")
    if cockpit and #cockpit > 0 then
        launch_codex()
        return
    end

    local task = hs.task.new("/usr/bin/open", function(exit_code)
        if exit_code ~= 0 then
            hs.alert.show("Cockpit Tools 启动失败")
            return
        end
        hs.timer.doAfter(1, launch_codex)
    end, { "-g", "-j", "-a", "Cockpit Tools" })

    if not task then
        hs.alert.show("无法创建 Cockpit Tools 启动任务")
        return
    end
    task:start()
end

local function focus_running_remote_debug_instance(item)
    if not item.remoteDebuggingPort then
        return false
    end

    local devtools_active_port_path = item.userDataDir and (item.userDataDir .. "/DevToolsActivePort") or nil
    if not devtools_active_port_path then
        return false
    end

    local handle = io.open(devtools_active_port_path, "r")
    if not handle then
        return false
    end

    local content = handle:read("*a")
    handle:close()

    local port = tonumber(string.match(content or "", "^(%d+)"))
    if not port then
        return false
    end

    local command = string.format("/usr/sbin/lsof -tiTCP:%d -sTCP:LISTEN 2>/dev/null", port)
    local output = hs.execute(command)
    local pid = tonumber(string.match(output or "", "(%d+)"))

    if not pid then
        return false
    end

    local app = hs.application.applicationForPID(pid)
    if not app then
        return false
    end

    app:activate()
    if item.bundleID == "com.google.Chrome" and #app:allWindows() == 0 then
        launch_with_args(item.app, item.launchArgs or {}, false)
    end
    return true
end

local function shell_quote(value)
    return "'" .. string.gsub(value, "'", "'\\''") .. "'"
end

local function focus_running_profile_instance(item)
    if item.bundleID == "com.google.Chrome" then
        local chromes = hs.application.applicationsForBundleID("com.google.Chrome")
        local target_dir = item.userDataDir
        if target_dir then target_dir = string.gsub(target_dir, "/$", "") end

        for _, app in ipairs(chromes) do
            local pid = app:pid()
            local command = string.format("ps -p %d -o args=", pid)
            local output = hs.execute(command)
            local actual_dir = string.match(output or "", "%-%-user%-data%-dir=([^%s]+)")
            if actual_dir then
                actual_dir = string.gsub(actual_dir, "^['\"]", "")
                actual_dir = string.gsub(actual_dir, "['\"]$", "")
                actual_dir = string.gsub(actual_dir, "/$", "")
            end

            -- If target_dir is nil (normal Chrome), only match apps with NO actual_dir
            -- If target_dir is set (debug Chrome), only match apps with matching actual_dir
            if (not target_dir and not actual_dir) or (target_dir and actual_dir == target_dir) then
                app:activate()
                if #app:allWindows() == 0 then
                    launch_with_args(item.app, item.launchArgs or {}, false)
                end
                return true
            end
        end
        return false
    end

    if not item.userDataDir then
        return false
    end

    local singleton_lock_path = item.userDataDir .. "/SingletonLock"
    local command = string.format("/usr/bin/readlink %s 2>/dev/null", shell_quote(singleton_lock_path))
    local output = hs.execute(command)
    local pid = tonumber(string.match(output or "", "%-(%d+)"))

    if not pid then
        return false
    end

    local app = hs.application.applicationForPID(pid)
    if not app then
        return false
    end

    app:activate()
    return true
end

local function launch_shortcut(item)
    if item.cockpitManagedCodex then
        launch_cockpit_managed_codex(item)
        return
    end

    if focus_running_remote_debug_instance(item) then
        return
    end

    if focus_running_profile_instance(item) then
        return
    end

    if item.userDataDir and not hs.fs.attributes(item.userDataDir) then
        hs.fs.mkdir(item.userDataDir)
    end

    if item.launchArgs then
        if launch_with_args(item.app, item.launchArgs, item.launchNewInstance) then
            return
        end
    elseif item.bundleID == "com.google.Chrome" then
        -- For normal Chrome, use -n to ensure it doesn't focus a debug instance if only debug is running
        if launch_with_args(item.app, {}, true) then
            return
        end
    end

    hs.application.launchOrFocus(item.app)
end

-- 注册快捷键
local function register_shortcuts(shortcuts, default_mods)
    for _, item in ipairs(shortcuts) do
        local mods = item.mods or default_mods
        hs.hotkey.bind(mods, item.key, function()
            launch_shortcut(item)
        end)
    end
end

-- 注册所有分类的快捷键
local default_mods = { "cmd", "ctrl" }
for _, category in pairs(app_shortcuts) do
    register_shortcuts(category, default_mods)
end
