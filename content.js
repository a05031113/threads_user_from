// Threads User Info - Content Script
// 注入 Threads 頁面，監聽 DOM 變化並顯示用戶資訊

(function () {
  'use strict';

  const PROCESSED_ATTR = 'data-threads-ext-processed';
  const INFO_CLASS = 'threads-ext-info';
  const DEBOUNCE_MS = 300;

  // 疑似假帳號提示：非台灣國家標黃、粉絲數過低標紅
  const TAIWAN_NAMES = ['台灣', '臺灣', '台湾', 'taiwan'];
  const MISSING_LOCATION_NAMES = ['n/a', '未分享', 'not shared'];
  const LOW_FOLLOWERS_THRESHOLD = 10;

  // 缺失（null / 空白 / N/A）比外國更可疑，標紅
  function isMissingLocation(location) {
    if (typeof location !== 'string') return true;
    const loc = location.trim().toLowerCase();
    return !loc || MISSING_LOCATION_NAMES.includes(loc);
  }

  function isForeignLocation(location) {
    if (isMissingLocation(location)) return false;
    return !TAIWAN_NAMES.includes(location.trim().toLowerCase());
  }

  function isLowFollowers(followers) {
    return typeof followers === 'number' && followers < LOW_FOLLOWERS_THRESHOLD;
  }

  // 以 DOM API 建構內容（值來自遠端資料，不可用 innerHTML）
  function renderInfo(infoSpan, location, followers) {
    infoSpan.classList.remove(`${INFO_CLASS}--loading`);
    infoSpan.textContent = '';

    const country = document.createElement('span');
    country.className = 'threads-ext-country';
    if (isMissingLocation(location)) {
      country.classList.add('threads-ext-country--missing');
    } else if (isForeignLocation(location)) {
      country.classList.add('threads-ext-country--foreign');
    }
    country.textContent = location;

    const fans = document.createElement('span');
    fans.className = 'threads-ext-followers';
    if (isLowFollowers(followers)) {
      fans.classList.add('threads-ext-followers--low');
    }
    fans.textContent = formatFollowers(followers);

    infoSpan.append(' • ', country, ' ', fans);
  }

  // TODO: 這些 selector 需要根據實際 Threads DOM 結構調整
  const SELECTORS = {
    // 貼文容器 - 需要用 DevTools 確認
    postContainer: '[data-pressable-container="true"]',
    // 用戶名連結 - 通常是 a 標籤連到 /@username
    usernameLink: 'a[href^="/@"]',
    // 時間戳 - 需要確認
    timestamp: 'time',
  };

  let debounceTimer = null;

  /**
   * 從貼文元素中提取 username
   */
  function extractUsername(postElement) {
    const link = postElement.querySelector(SELECTORS.usernameLink);
    if (!link) return null;

    const href = link.getAttribute('href');
    if (!href) return null;

    // href 格式: /@username 或 /@username/...
    const match = href.match(/^\/@([^/?]+)/);
    return match ? match[1] : null;
  }

  /**
   * 格式化 follower 數量
   * 例如: 12500 -> "12.5K", 1234567 -> "1.2M"
   */
  function formatFollowers(count) {
    if (typeof count !== 'number') return '?';
    if (count >= 1000000) {
      return (count / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    }
    if (count >= 1000) {
      return (count / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    }
    return count.toString();
  }

  /**
   * 在貼文中注入用戶資訊
   */
  function injectInfo(postElement, location, followers) {
    // 找到時間戳元素
    const timestamp = postElement.querySelector(SELECTORS.timestamp);
    if (!timestamp) {
      console.log('[Threads Ext] Cannot find timestamp element');
      return;
    }

    // 檢查是否已經注入
    const existingInfo = postElement.querySelector(`.${INFO_CLASS}`);
    if (existingInfo) {
      // 更新現有的
      renderInfo(existingInfo, location, followers);
      return;
    }

    // 建立新的資訊元素
    const infoSpan = document.createElement('span');
    infoSpan.className = INFO_CLASS;
    renderInfo(infoSpan, location, followers);

    // 插入到時間戳後面
    timestamp.parentNode.insertBefore(infoSpan, timestamp.nextSibling);
  }

  /**
   * 顯示載入中狀態
   */
  function injectLoading(postElement) {
    const timestamp = postElement.querySelector(SELECTORS.timestamp);
    if (!timestamp) return;

    const existingInfo = postElement.querySelector(`.${INFO_CLASS}`);
    if (existingInfo) return;

    const infoSpan = document.createElement('span');
    infoSpan.className = `${INFO_CLASS} ${INFO_CLASS}--loading`;
    infoSpan.textContent = ' • ...';

    timestamp.parentNode.insertBefore(infoSpan, timestamp.nextSibling);
  }

  /**
   * 處理單則貼文
   */
  async function processPost(postElement) {
    // 已處理過就跳過
    if (postElement.hasAttribute(PROCESSED_ATTR)) return;

    const username = extractUsername(postElement);
    if (!username) return;

    // 標記為已處理
    postElement.setAttribute(PROCESSED_ATTR, 'true');

    // 顯示載入中
    injectLoading(postElement);

    try {
      // 先提取 tokens（用於 wbloks API）
      const tokens = extractTokensFromPage();

      // 向 background.js 請求 userId 和 followers（不需要 cookies）
      const response = await chrome.runtime.sendMessage({
        type: 'GET_USER_INFO',
        username: username,
      });

      if (response && response.success) {
        const { userId, followers } = response.data;
        let country = null;

        // 在 content.js 中呼叫 wbloks API（需要 cookies）
        if (userId && tokens?.lsd) {
          country = await fetchCountryFromWbloks(userId, tokens);
        }

        injectInfo(postElement, country || 'N/A', followers ?? null);
      } else {
        // API 失敗時，顯示 N/A
        injectInfo(postElement, 'N/A', null);
      }
    } catch (error) {
      console.error('[Threads Ext] Error fetching user info:', error);
      injectInfo(postElement, 'N/A', null);
    }
  }

  /**
   * 處理頁面上所有未處理的貼文
   */
  function processAllPosts() {
    const posts = document.querySelectorAll(
      `${SELECTORS.postContainer}:not([${PROCESSED_ATTR}])`
    );

    posts.forEach((post) => {
      processPost(post);
    });
  }

  /**
   * Debounced 版本的 processAllPosts
   */
  function debouncedProcessAllPosts() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      processAllPosts();
    }, DEBOUNCE_MS);
  }

  /**
   * 設定 MutationObserver 監聽 DOM 變化
   */
  function setupObserver() {
    const observer = new MutationObserver((mutations) => {
      // 檢查是否有新增的節點
      let hasNewNodes = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
          break;
        }
      }

      if (hasNewNodes) {
        debouncedProcessAllPosts();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    console.log('[Threads Ext] MutationObserver started');
  }

  /**
   * 初始化
   */
  function init() {
    console.log('[Threads Ext] Content script loaded');

    // 處理已存在的貼文
    processAllPosts();

    // 監聽後續的 DOM 變化
    setupObserver();
  }

  /**
   * 呼叫 wbloks API 獲取國家資訊（必須在 content script 中執行才能帶 cookies）
   */
  async function fetchCountryFromWbloks(userId, tokens) {
    try {
      if (!userId || !tokens?.lsd) {
        console.log('[Threads Ext] fetchCountryFromWbloks: missing userId or lsd');
        return null;
      }

      const formData = new URLSearchParams();
      formData.append('__user', '0');
      formData.append('__a', '1');
      formData.append('__req', '1');
      formData.append('fb_dtsg', tokens.fbDtsg || '');
      formData.append('lsd', tokens.lsd);
      formData.append('__d', 'www');
      formData.append('params', JSON.stringify({
        atpTriggerSessionID: crypto.randomUUID(),
        referer_type: 'TextPostAppProfileOverflow',
        target_user_id: userId
      }));

      const bkv = tokens.bkv || '2df3a9e4bce0954504db15ca7a726eb2b7bc88f40014097d540c0fd8ef412796';
      const url = `https://www.threads.com/async/wbloks/fetch/?appid=com.bloks.www.text_post_app.about_this_profile_async_action&type=app&__bkv=${bkv}`;

      console.log(`[Threads Ext] Calling wbloks API for user_id: ${userId}`);

      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-IG-App-ID': '238260118697367'
        },
        body: formData.toString()
      });

      if (!response.ok) {
        console.error(`[Threads Ext] wbloks API failed: ${response.status}`);
        return null;
      }

      const text = await response.text();
      console.log('[Threads Ext] wbloks API response (first 300 chars):', text.substring(0, 300));

      const countryMatch = text.match(
        /"key":"THREADS_ABOUT_THIS_PROFILE:about_this_profile_country"[^}]*"initial":"((?:[^"\\]|\\.)*)"/
      );

      const country = countryMatch ? decodeJsonString(countryMatch[1]) : null;
      console.log(`[Threads Ext] wbloks API - country: ${country}`);

      return country;
    } catch (error) {
      console.error('[Threads Ext] fetchCountryFromWbloks error:', error);
      return null;
    }
  }

  function decodeJsonString(raw) {
    if (!raw) return null;
    try {
      return JSON.parse('"' + raw + '"') || null;
    } catch (e) {
      console.warn('[Threads Ext] Failed to decode JSON string, using raw:', raw, e);
      return raw;
    }
  }

  /**
   * 從頁面的 script 標籤中提取 Threads tokens
   * 需要提取 LSD token 和 fb_dtsg token
   */
  function extractTokensFromPage() {
    const scripts = document.querySelectorAll('script');
    let lsd = null;
    let fbDtsg = null;

    console.log('[Threads Ext] Searching for tokens in', scripts.length, 'script tags');

    for (const script of scripts) {
      const text = script.textContent;
      if (!text) continue;

      // 提取 LSD token - 嘗試多種格式
      if (!lsd) {
        // 格式 1: "LSD",[],{"token":"xxx"}
        let lsdMatch = text.match(/"LSD"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/);
        if (lsdMatch) {
          lsd = lsdMatch[1];
          console.log('[Threads Ext] Found LSD token (format 1)');
        }

        // 格式 2: "LSD":{"token":"xxx"}
        if (!lsd) {
          lsdMatch = text.match(/"LSD"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/);
          if (lsdMatch) {
            lsd = lsdMatch[1];
            console.log('[Threads Ext] Found LSD token (format 2)');
          }
        }
      }

      // 提取 fb_dtsg token - 嘗試多種格式
      if (!fbDtsg) {
        // 格式 1: "DTSGInitialData",[],{"token":"xxx"}
        let dtsgMatch = text.match(/"DTSGInitialData"\s*,\s*\[\]\s*,\s*\{\s*"token"\s*:\s*"([^"]+)"/);
        if (dtsgMatch) {
          fbDtsg = dtsgMatch[1];
          console.log('[Threads Ext] Found fb_dtsg token (format 1)');
        }

        // 格式 2: "DTSGInitialData":{"token":"xxx"}
        if (!fbDtsg) {
          dtsgMatch = text.match(/"DTSGInitialData"\s*:\s*\{\s*"token"\s*:\s*"([^"]+)"/);
          if (dtsgMatch) {
            fbDtsg = dtsgMatch[1];
            console.log('[Threads Ext] Found fb_dtsg token (format 2)');
          }
        }

        // 格式 3: 直接搜尋 fb_dtsg
        if (!fbDtsg) {
          dtsgMatch = text.match(/"fb_dtsg"\s*:\s*"([^"]+)"/);
          if (dtsgMatch) {
            fbDtsg = dtsgMatch[1];
            console.log('[Threads Ext] Found fb_dtsg token (format 3)');
          }
        }
      }

      // 如果都找到了就停止
      if (lsd && fbDtsg) break;
    }

    // 嘗試提取 __bkv (bloks versioning key)
    let bkv = null;
    for (const script of scripts) {
      const text = script.textContent;
      if (!text) continue;

      // 搜尋 __bkv 或 bkv
      const bkvMatch = text.match(/"__bkv"\s*:\s*"([^"]+)"/);
      if (bkvMatch) {
        bkv = bkvMatch[1];
        console.log('[Threads Ext] Found __bkv:', bkv.substring(0, 20) + '...');
        break;
      }
    }

    console.log('[Threads Ext] Extracted tokens:', {
      lsd: lsd ? lsd.substring(0, 10) + '...' : null,
      fbDtsg: fbDtsg ? fbDtsg.substring(0, 10) + '...' : null,
      bkv: bkv ? bkv.substring(0, 20) + '...' : null
    });

    return {
      lsd: lsd,
      fbDtsg: fbDtsg,
      bkv: bkv,
      appId: '238260118697367', // Threads 固定 App ID
    };
  }

  /**
   * 監聽來自 background script 的訊息
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'EXTRACT_TOKENS') {
      const tokens = extractTokensFromPage();
      sendResponse(tokens);
      return true; // 保持 message channel 開啟（異步回應）
    }
  });

  // 確保 DOM 已載入
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
