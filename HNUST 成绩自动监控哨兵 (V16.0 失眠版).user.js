// ==UserScript==
// @name         HNUST 成绩自动监控哨兵 (V16.0 失眠版)
// @namespace    http://tampermonkey.net/
// @version      16.0
// @description  引入Web Worker多线程技术，突破浏览器后台休眠限制，最小化也能稳定运行
// @author       Castian & Caleb
// @match        *://kdjw.hnust.edu.cn/jsxsd/*
// @grant        GM_notification
// ==/UserScript==

(function() {
    'use strict';

    // --- 配置区 ---
    const CLICK_INTERVAL_MINUTES = 5; 
    const CHECK_KEY = "grade_course_names";
    const TARGET_FRAME_NAME = "cjcx_list_frm"; 

    // --- 核心黑科技：创建一个不会睡觉的 Web Worker ---
    // 这段代码运行在独立线程里，浏览器管不着它
    const workerBlob = new Blob([`
        var seconds = 0;
        var limit = 0;
        var isRunning = false;

        self.onmessage = function(e) {
            if (e.data.command === 'start') {
                limit = e.data.limit;
                seconds = limit;
                isRunning = true;
                tick();
            } else if (e.data.command === 'stop') {
                isRunning = false;
            }
        };

        function tick() {
            if (!isRunning) return;
            
            seconds--;
            // 每秒向主线程汇报一次
            self.postMessage({ type: 'tick', seconds: seconds });

            if (seconds <= 0) {
                // 时间到，通知主线程干活
                self.postMessage({ type: 'trigger' });
                seconds = limit; // 重置倒计时
            }
            
            setTimeout(tick, 1000);
        }
    `], { type: "text/javascript" });

    // --- 按钮定位 ---
    function findRealQueryBtn() {
        var btn = document.querySelector('button.opt-b-btn[onclick*="queryKscj"]');
        return btn;
    }

    var targetBtn = findRealQueryBtn();
    if (!targetBtn) return; 

    // --- 状态栏 UI ---
    var container = document.createElement("div");
    container.style.cssText = "position:fixed; bottom:10px; left:10px; z-index:999999; display:flex; align-items:center; gap:5px; font-family: 'Microsoft YaHei', sans-serif;";

    var statusText = document.createElement("div");
    statusText.style.cssText = "background:rgba(0,0,0,0.9); color:#fff; padding:8px 12px; border-radius:4px; font-size:12px; border: 1px solid #666;";
    statusText.innerHTML = "● 哨兵V16 <span style='color:#aaa'>| 待命</span>";
    
    var startBtn = document.createElement("button");
    startBtn.innerText = "▶ 启动强力监控";
    startBtn.style.cssText = "background:#d9534f; color:white; border:none; padding:8px 15px; border-radius:4px; cursor:pointer; font-weight:bold; font-size:12px;";
    
    container.appendChild(statusText);
    container.appendChild(startBtn);
    document.body.appendChild(container);

    // --- 启动 Worker ---
    var worker = new Worker(window.URL.createObjectURL(workerBlob));

    // --- 监听 Worker 的心跳 ---
    worker.onmessage = function(e) {
        if (e.data.type === 'tick') {
            // 更新 UI 倒计时
            var s = e.data.seconds;
            if (s % 10 === 0 || s < 10) {
                 var min = Math.floor(s / 60);
                 var sec = s % 60;
                 if (!statusText.innerHTML.includes("正在")) {
                     statusText.innerHTML = "● 强力监控中 <span style='color:#0f0'>" + min + "分" + sec + "秒</span> 后刷新";
                 }
            }
        } 
        else if (e.data.type === 'trigger') {
            // 收到 Worker 的命令，开始干活
            performCheck();
        }
    };

    // --- 启动逻辑 ---
    startBtn.onclick = function() {
        startBtn.style.display = "none"; 
        statusText.style.borderColor = "#d9534f"; // 红色边框代表强力模式
        statusText.innerHTML = "🚀 正在查询...";
        
        // 立即执行一次
        performCheck();

        // 告诉 Worker：开始计时，设定间隔
        worker.postMessage({ command: 'start', limit: CLICK_INTERVAL_MINUTES * 60 });
    };

    // --- 动作：点击并跨楼层搜查 ---
    function performCheck() {
        var btn = findRealQueryBtn();
        if (!btn) {
            statusText.innerText = "❌ 按钮丢失";
            return;
        }

        statusText.innerHTML = "⚡ 点击查询...";
        statusText.style.color = "yellow";
        
        btn.click(); 

        var attempts = 0;
        var checkLoop = setInterval(function() {
            attempts++;
            var result = getCourseData();
            
            if (result.found) {
                clearInterval(checkLoop);
                handleResult(result.courses);
            } else {
                if (attempts >= 20) { 
                    clearInterval(checkLoop);
                    statusText.innerHTML = "⚠️ 超时：未读到数据";
                    statusText.style.color = "orange";
                }
            }
        }, 1000);
    }

    // --- 提取课程名单 ---
    function getCourseData() {
        try {
            var listWin = window.parent.frames[TARGET_FRAME_NAME];
            if (!listWin || !listWin.document) return { found: false, courses: [] };

            var table = listWin.document.getElementById("dataList");
            if (!table) return { found: false, courses: [] };

            var dataRows = table.querySelectorAll("tr td"); 
            if (dataRows.length === 0) return { found: false, courses: [] };

            var rows = table.querySelectorAll("tr");
            var currentCourses = [];

            for (var i = 0; i < rows.length; i++) {
                var cells = rows[i].querySelectorAll("td");
                if (cells.length > 4) {
                    var courseName = cells[3].innerText.trim();
                    if (courseName && courseName.length > 1) {
                        currentCourses.push(courseName);
                    }
                }
            }
            return { found: true, courses: currentCourses };

        } catch (e) { console.log(e); }
        return { found: false, courses: [] };
    }

    // --- 对比名单与报警 ---
    function handleResult(currentCourses) {
        var lastJson = localStorage.getItem(CHECK_KEY);
        var lastCourses = lastJson ? JSON.parse(lastJson) : [];
        var count = currentCourses.length;
        var msg = "● 强力监控中 | 已出: <strong style='color:#0f0; font-size:14px;'>" + count + "</strong> 门";

        if (lastJson === null) {
            localStorage.setItem(CHECK_KEY, JSON.stringify(currentCourses));
            GM_notification({ text: "哨兵初始化！当前已出：\n" + currentCourses.join("，"), title: "🛡️ 监控启动" });
        } 
        else {
            var newCourses = currentCourses.filter(course => !lastCourses.includes(course));
            if (newCourses.length > 0) {
                var notificationText = "出分啦！新增 " + newCourses.length + " 门：\n👉 " + newCourses.join("\n👉 ");
                GM_notification({
                    text: notificationText,
                    title: "🎉 成绩发布警报",
                    timeout: 0, 
                    onclick: function() { window.focus(); }
                });
                localStorage.setItem(CHECK_KEY, JSON.stringify(currentCourses));
                msg = "🎉 刚才出了：" + newCourses[0];
            }
        }
        statusText.innerHTML = msg;
        statusText.style.color = "#fff";
    }

})();