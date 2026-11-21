// Threads User Info - Background Service Worker
// 處理 wbloks API 請求與快取管理
// v1.0.5 - 使用正確的 "About this profile" API 獲取國家資訊

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 小時
const CACHE_KEY_PREFIX = 'v2_user_'; // 快取 key 前綴（v1.0.9 起改用 v2_，作廢舊的 0 粉絲毒快取）
const LEGACY_CACHE_KEY_PREFIX = 'user_';
const REQUEST_DELAY_MS = 300; // 請求間隔，避免 rate limiting
const THREADS_APP_ID = '238260118697367'; // Threads 固定 App ID

// wbloks API 端點（用於獲取 "About this profile" 資訊）
// 注意：API 只在 threads.com 有效，threads.net 會因 session 問題失敗
const WBLOKS_API_URL = 'https://www.threads.com/async/wbloks/fetch/';
const WBLOKS_APP_ID = 'com.bloks.www.text_post_app.about_this_profile_async_action';
const WBLOKS_BKV = '2df3a9e4bce0954504db15ca7a726eb2b7bc88f40014097d540c0fd8ef412796';

// 支援的 Threads 域名
const THREADS_DOMAINS = ['threads.net', 'threads.com'];

// 請求佇列，避免同時發送多個請求
let requestQueue = [];
let isProcessingQueue = false;

// 國家/城市名稱對應兩字母代碼
const COUNTRY_CODES = {
  // 亞洲國家
  taiwan: 'TW',
  '台灣': 'TW',
  'taiwan, province of china': 'TW',
  japan: 'JP',
  '日本': 'JP',
  'south korea': 'KR',
  korea: 'KR',
  '韓國': 'KR',
  china: 'CN',
  '中國': 'CN',
  'hong kong': 'HK',
  '香港': 'HK',
  singapore: 'SG',
  '新加坡': 'SG',
  malaysia: 'MY',
  '馬來西亞': 'MY',
  thailand: 'TH',
  '泰國': 'TH',
  vietnam: 'VN',
  '越南': 'VN',
  philippines: 'PH',
  '菲律賓': 'PH',
  indonesia: 'ID',
  '印尼': 'ID',
  india: 'IN',
  '印度': 'IN',

  // 亞洲城市
  tokyo: 'JP',
  '東京': 'JP',
  osaka: 'JP',
  '大阪': 'JP',
  kyoto: 'JP',
  '京都': 'JP',
  taipei: 'TW',
  '台北': 'TW',
  seoul: 'KR',
  '首爾': 'KR',
  beijing: 'CN',
  '北京': 'CN',
  shanghai: 'CN',
  '上海': 'CN',
  bangkok: 'TH',
  '曼谷': 'TH',

  // 北美
  'united states': 'US',
  usa: 'US',
  '美國': 'US',
  canada: 'CA',
  '加拿大': 'CA',
  mexico: 'MX',
  '墨西哥': 'MX',
  'new york': 'US',
  '紐約': 'US',
  'los angeles': 'US',
  '洛杉磯': 'US',

  // 歐洲
  'united kingdom': 'GB',
  uk: 'GB',
  '英國': 'GB',
  germany: 'DE',
  '德國': 'DE',
  france: 'FR',
  '法國': 'FR',
  italy: 'IT',
  '義大利': 'IT',
  spain: 'ES',
  '西班牙': 'ES',
  netherlands: 'NL',
  '荷蘭': 'NL',
  london: 'GB',
  '倫敦': 'GB',
  paris: 'FR',
  '巴黎': 'FR',

  // 大洋洲
  australia: 'AU',
  '澳洲': 'AU',
  'new zealand': 'NZ',
  '紐西蘭': 'NZ',
  sydney: 'AU',
  '雪梨': 'AU',

  // 其他常見
  brazil: 'BR',
  '巴西': 'BR',
  argentina: 'AR',
  '阿根廷': 'AR',
};

/**
 * 將國家/城市名稱轉換為兩字母代碼
 */
function countryToCode(locationName) {
  if (!locationName) return 'N/A';

  const normalized = locationName.toLowerCase().trim();

  // 直接匹配（支援中文和英文）
  if (COUNTRY_CODES[normalized]) {
    return COUNTRY_CODES[normalized];
  }

  // 也檢查原始字串（保留大小寫）
  if (COUNTRY_CODES[locationName.trim()]) {
    return COUNTRY_CODES[locationName.trim()];
  }

  // 部分匹配（例如 "Tokyo, Japan" 中的 "Japan"）
  for (const [name, code] of Object.entries(COUNTRY_CODES)) {
    if (normalized.includes(name)) {
      return code;
    }
  }

  // 如果已經是兩字母代碼，直接返回
  if (/^[A-Z]{2}$/.test(locationName.toUpperCase())) {
    return locationName.toUpperCase();
  }

  // 如果找不到匹配，返回原始字串的前 3 個字符（大寫）
  // 這樣至少能顯示一些資訊
  if (locationName.length > 0) {
    return locationName.substring(0, 3).toUpperCase();
  }

  return 'N/A';
}

/**
 * 從快取取得用戶資料
 */
async function getFromCache(username) {
  try {
    const key = CACHE_KEY_PREFIX + username;
    const result = await chrome.storage.local.get(key);
    const cached = result[key];

    if (!cached) return null;

    // 檢查是否過期
    if (Date.now() - cached.timestamp > CACHE_DURATION_MS) {
      // 過期了，刪除
      await chrome.storage.local.remove(key);
      return null;
    }

    return cached.data;
  } catch (error) {
    console.error('[Threads Ext] Cache read error:', error);
    return null;
  }
}

/**
 * 儲存到快取
 */
async function saveToCache(username, data) {
  try {
    const key = CACHE_KEY_PREFIX + username;
    await chrome.storage.local.set({
      [key]: {
        data: data,
        timestamp: Date.now(),
      },
    });
  } catch (error) {
    console.error('[Threads Ext] Cache write error:', error);
  }
}

/**
 * 將中文數字格式轉換為數字
 * 例如: "15.1 萬" -> 151000, "1.2K" -> 1200
 */
function parseChineseNumber(str) {
  if (!str) return 0;

  // 移除空白和 "位粉絲" 等文字
  str = str.replace(/\s+|位粉絲|followers|,/gi, '');

  // 處理 "萬" (10,000)
  const wanMatch = str.match(/([\d.]+)\s*萬/i);
  if (wanMatch) {
    return Math.round(parseFloat(wanMatch[1]) * 10000);
  }

  // 處理 "K" (1,000)
  const kMatch = str.match(/([\d.]+)\s*K/i);
  if (kMatch) {
    return Math.round(parseFloat(kMatch[1]) * 1000);
  }

  // 處理 "M" (1,000,000)
  const mMatch = str.match(/([\d.]+)\s*M/i);
  if (mMatch) {
    return Math.round(parseFloat(mMatch[1]) * 1000000);
  }

  // 一般數字
  const numMatch = str.match(/\d+/);
  return numMatch ? parseInt(numMatch[0], 10) : 0;
}

/**
 * 從 profile 頁面 HTML 中提取 user_id
 * user_id 是數字格式，用於呼叫 wbloks API
 */
async function getUserIdFromProfile(username) {
  try {
    const response = await fetch(`https://www.threads.com/@${username}`, {
      credentials: 'include',
      headers: {
        'Accept': 'text/html',
        'User-Agent': navigator.userAgent,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();

    // 搜尋 user_id":"數字" 格式
    // 使用 [0-9] 而不是 \d 避免 Unicode 問題
    const searchStr = 'user_id":"';
    let pos = 0;

    while (true) {
      const idx = html.indexOf(searchStr, pos);
      if (idx === -1) break;

      const start = idx + searchStr.length;
      const end = html.indexOf('"', start);

      if (end > start && end - start < 20) {
        const userId = html.substring(start, end);
        // 驗證是純數字
        if (/^[0-9]+$/.test(userId)) {
          console.log(`[Threads Ext] Found user_id for @${username}: ${userId}`);
          return { userId, html };
        }
      }

      pos = idx + 1;
    }

    console.error(`[Threads Ext] Could not find user_id for @${username}`);
    return { userId: null, html };
  } catch (error) {
    console.error('[Threads Ext] getUserIdFromProfile error:', error);
    return { userId: null, html: null };
  }
}

/**
 * 呼叫 wbloks API 獲取 "About this profile" 資訊
 * 這個 API 返回用戶的國家資訊
 */
async function fetchAboutThisProfile(userId, tokens) {
  try {
    if (!userId || !tokens?.lsd) {
      console.error('[Threads Ext] Missing userId or tokens');
      return null;
    }

    console.log('[Threads Ext] fetchAboutThisProfile - tokens received:', {
      lsd: tokens.lsd ? tokens.lsd.substring(0, 10) + '...' : null,
      fbDtsg: tokens.fbDtsg ? tokens.fbDtsg.substring(0, 10) + '...' : null,
      bkv: tokens.bkv ? tokens.bkv.substring(0, 20) + '...' : null,
    });

    // 使用動態 __bkv（如果有的話），否則使用預設值
    const bkvToUse = tokens.bkv || WBLOKS_BKV;
    console.log('[Threads Ext] Using __bkv:', bkvToUse.substring(0, 20) + '...');

    const formData = new URLSearchParams();
    formData.append('__user', '0');
    formData.append('__a', '1');
    formData.append('__req', '1');
    formData.append('__hs', '20168.HYP:barcelona_web_pkg.2.1...0.0');
    formData.append('dpr', '1');
    formData.append('__ccg', 'EXCELLENT');
    formData.append('__rev', '1020168166');
    formData.append('__comet_req', '7');
    formData.append('fb_dtsg', tokens.fbDtsg || '');
    formData.append('lsd', tokens.lsd);
    formData.append('__d', 'www');
    formData.append('__spin_r', '1020168166');
    formData.append('__spin_b', 'trunk');
    formData.append('__spin_t', Math.floor(Date.now() / 1000).toString());
    formData.append('params', JSON.stringify({
      atpTriggerSessionID: crypto.randomUUID(),
      referer_type: 'TextPostAppProfileOverflow',
      target_user_id: userId
    }));

    const url = `${WBLOKS_API_URL}?appid=${WBLOKS_APP_ID}&type=app&__bkv=${bkvToUse}`;

    console.log(`[Threads Ext] Calling wbloks API for user_id: ${userId}`);

    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-IG-App-ID': THREADS_APP_ID
      },
      body: formData.toString()
    });

    if (!response.ok) {
      console.error(`[Threads Ext] wbloks API failed: ${response.status}`);
      return null;
    }

    const text = await response.text();

    // Debug: 顯示回應的前 500 字符
    console.log(`[Threads Ext] wbloks API raw response (first 500 chars):`, text.substring(0, 500));

    // 解析國家資訊
    // 格式: "key":"THREADS_ABOUT_THIS_PROFILE:about_this_profile_country"..."initial":"Canada"
    const countryMatch = text.match(
      /"key":"THREADS_ABOUT_THIS_PROFILE:about_this_profile_country"[^}]*"initial":"((?:[^"\\]|\\.)*)"/
    );

    // 也嘗試其他可能的格式
    let country = countryMatch ? decodeJsonString(countryMatch[1]) : null;

    if (!country) {
      // 嘗試搜尋 "about_this_profile_country" 相關內容
      const altMatch = text.match(/about_this_profile_country[^"]*"[^"]*"((?:[^"\\]|\\.)+)"/);
      if (altMatch) {
        console.log(`[Threads Ext] Found country via alt regex:`, altMatch[1]);
        country = decodeJsonString(altMatch[1]);
      }
    }

    if (!country) {
      // 搜尋任何包含 country 的欄位
      const countryFieldMatch = text.match(/"country[^"]*":\s*"([^"]+)"/i);
      if (countryFieldMatch) {
        console.log(`[Threads Ext] Found country field:`, countryFieldMatch[0]);
      }
    }

    console.log(`[Threads Ext] wbloks API response - country: ${country}`);

    return { country };
  } catch (error) {
    console.error('[Threads Ext] fetchAboutThisProfile error:', error);
    return null;
  }
}

/**
 * 解碼 JSON 字串內容（如 \\u53f0\\u7063 -> 台灣）；失敗時回傳原字串
 */
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
 * 解碼 HTML entities（service worker 沒有 DOMParser）
 */
function decodeHtmlEntities(str) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' };
  return str.replace(/&(?:#x([0-9a-fA-F]+)|#([0-9]+)|([a-zA-Z]+));/g, (m, hex, dec, name) => {
    try {
      if (hex) return String.fromCodePoint(parseInt(hex, 16));
      if (dec) return String.fromCodePoint(parseInt(dec, 10));
    } catch (e) {
      return m;
    }
    return Object.prototype.hasOwnProperty.call(named, name) ? named[name] : m;
  });
}

/**
 * 從 HTML 中提取粉絲數
 * @param {string} html - profile 頁面的 HTML
 * @param {string} [username] - 僅用於 log
 * @returns {number|null} 粉絲數；解析失敗回傳 null（真正的 0 粉絲回傳 0）
 */
function extractFollowersFromHtml(html, username) {
  const who = username ? ` for @${username}` : '';
  if (!html) {
    console.warn(`[Threads Ext] No HTML, cannot parse followers${who}`);
    return null;
  }

  // 從 meta description（或 og:description）提取粉絲數；content 為 HTML-entity 編碼
  const metaMatch =
    html.match(/<meta\s+name="description"\s+content="([^"]*)"/i) ||
    html.match(/<meta\s+property="og:description"\s+content="([^"]*)"/i);

  if (metaMatch) {
    const metaContent = decodeHtmlEntities(metaMatch[1]).replace(/\u00a0/g, ' ');
    const followersMatch = metaContent.match(
      /([\d.,]+\s*[萬KMk]?)\s*位?粉絲|([\d.,]+\s*[KMk]?)\s*followers/i
    );
    if (followersMatch) {
      const followersStr = followersMatch[1] || followersMatch[2];
      return parseChineseNumber(followersStr);
    }
    console.warn(`[Threads Ext] No follower pattern in meta description${who}`);
    return null;
  }

  console.warn(`[Threads Ext] No description meta found${who}`);
  return null;
}

/**
 * 從 content script 提取 Threads tokens
 * 根據 info.md，需要從頁面的 script 標籤提取 LSD token
 */
async function getThreadsTokens() {
  try {
    // 向 content script 請求 tokens（支援 threads.net 和 threads.com）
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
      url: ['https://www.threads.net/*', 'https://www.threads.com/*'],
    });

    if (tabs.length === 0) {
      console.error('[Threads Ext] No active Threads tab found');
      return null;
    }

    const response = await chrome.tabs.sendMessage(tabs[0].id, {
      type: 'EXTRACT_TOKENS',
    });

    return response;
  } catch (error) {
    console.error('[Threads Ext] Failed to extract tokens:', error);
    return null;
  }
}

/**
 * 取得用戶資訊（主要入口）
 * 只負責獲取 userId 和 followers（不需要 cookies）
 * wbloks API 由 content.js 呼叫（需要 cookies）
 * @param {string} username - 用戶名
 */
async function getUserInfo(username) {
  // 1. 先檢查快取
  const cached = await getFromCache(username);
  if (cached) {
    console.log(`[Threads Ext] Cache hit for @${username}`);
    return cached;
  }

  console.log(`[Threads Ext] Fetching data for @${username}`);

  try {
    // 2. 獲取 user_id 和 HTML（一次請求完成）
    const { userId, html } = await getUserIdFromProfile(username);

    // 3. 從 HTML 提取粉絲數
    const followers = extractFollowersFromHtml(html, username);
    console.log(`[Threads Ext] Extracted for @${username}: userId=${userId}, followers=${followers}`);

    const data = { userId, followers };

    // 4. 只在粉絲數解析成功時快取（null 代表解析失敗，不可快取）
    if (typeof followers === 'number') {
      await saveToCache(username, data);
    }

    return data;
  } catch (error) {
    console.error(`[Threads Ext] Error fetching data for @${username}:`, error);
    return { userId: null, followers: null };
  }
}

// 啟動時一次性清除舊前綴（v1.0.8 以前）的快取
(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const old = Object.keys(all).filter((k) => k.startsWith(LEGACY_CACHE_KEY_PREFIX));
    if (old.length) await chrome.storage.local.remove(old);
  } catch (error) {
    console.error('[Threads Ext] Legacy cache cleanup error:', error);
  }
})();

// 監聽來自 content script 的訊息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_USER_INFO') {
    const { username } = message;

    console.log('[Threads Ext] Received GET_USER_INFO for:', username);

    getUserInfo(username)
      .then((data) => {
        sendResponse({ success: true, data });
      })
      .catch((error) => {
        console.error('[Threads Ext] Error:', error);
        sendResponse({ success: false, error: error.message });
      });

    // 返回 true 表示會異步回應
    return true;
  }
});

console.log('[Threads Ext] Background service worker started');
