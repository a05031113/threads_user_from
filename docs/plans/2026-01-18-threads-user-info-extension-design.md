# Threads User Info Chrome Extension - Design Document

**Date:** 2026-01-18
**Status:** Approved

## Overview

Chrome 擴充套件，在 Threads 動態牆上顯示發文者的國籍與追蹤數，幫助快速判斷內容參考價值。

## User Requirements

| 項目 | 決定 |
|------|------|
| 顯示位置 | 動態牆，時間戳後面 |
| 顯示格式 | `• TW 12.5K` |
| 國籍格式 | 兩字母代碼 (TW/JP/US) |
| 無國籍時 | 顯示 `N/A` |
| 資料取得 | 即時查詢 + 短期快取 |

**顯示範例：**
```
linchiafish › fujfilm  21h • TW 12.5K
```

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Chrome Extension                      │
├─────────────────────────────────────────────────────────┤
│  manifest.json          - 擴充套件設定 (Manifest V3)     │
│  content.js             - 注入 Threads 頁面，操作 DOM    │
│  background.js          - Service Worker，處理 API 請求  │
│  styles.css             - 注入的樣式                     │
└─────────────────────────────────────────────────────────┘
```

**資料流：**
1. Content Script 監聽 DOM 變化（偵測新貼文出現）
2. 發現新貼文 → 提取 username
3. 透過 Background Script 發請求到 Threads 取得用戶資料
4. 將 "TW 12.5K" 注入到貼文的時間戳後面

## File Structure

```
threads-user-info/
├── manifest.json           # 擴充套件設定
├── background.js           # Service Worker - 處理 API 請求與快取
├── content.js              # 注入 Threads 頁面的腳本
├── styles.css              # 注入的樣式
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

## Data Fetching Strategy

```
貼文出現 ──► 提取 username ──► 檢查快取
                                   │
                        ┌──────────┴──────────┐
                        ▼                     ▼
                   有快取                  無快取
                   (< 1hr)
                        │                     │
                        ▼                     ▼
                   直接使用            發 API 請求
                                              │
                                              ▼
                                     儲存到快取
                                              │
                        └──────────┬──────────┘
                                   ▼
                             注入 DOM
```

**資料來源：**
1. 優先：Threads GraphQL API（需研究 endpoint）
2. Fallback：抓取 Profile 頁面 HTML 解析

**快取策略：**
- 儲存在 `chrome.storage.local`
- 快取 1 小時
- 格式：`{ "username": { location: "TW", followers: 12500, timestamp: ... } }`

## DOM Injection

**注入位置：** 時間戳 (`21h`) 後面

```html
<!-- 原始 -->
<span class="timestamp">21h</span>

<!-- 注入後 -->
<span class="timestamp">21h</span>
<span class="threads-ext-info"> • TW 12.5K</span>
```

**Content Script 核心邏輯：**
- 使用 MutationObserver 監聽 DOM 變化
- 用 `data-processed` 屬性標記已處理貼文，避免重複處理
- 加 debounce 減少處理頻率

## Implementation Phases

### Phase 1：基礎架構
- 建立 manifest.json
- 建立空的 content.js / background.js
- 在 Chrome 載入擴充套件測試

### Phase 2：研究 Threads DOM 與 API
- 用 DevTools 分析動態牆的 DOM 結構
- 找出 username、timestamp 的 CSS selector
- 觀察 "About this profile" 的 API 請求

### Phase 3：實作 Content Script
- MutationObserver 監聽新貼文
- 提取 username
- 注入佔位元素（先顯示 "載入中..."）

### Phase 4：實作 Background Script
- 處理 content script 的訊息
- 發 API 請求取得用戶資料
- 快取管理

### Phase 5：整合與優化
- 串接 content ↔ background
- 錯誤處理
- 樣式調整

## Risks and Mitigations

| 風險 | 對策 |
|------|------|
| Threads DOM 結構改變 | 使用多個 fallback selector，定期維護 |
| API 被阻擋/限流 | 快取 + 請求間隔限制 (rate limiting) |
| Location 需點擊 "About this profile" 才載入 | 研究是否有其他 API 可直接取得 |
| 某些用戶沒設定 location | 顯示 "N/A" |

## Manifest Configuration

```json
{
  "manifest_version": 3,
  "name": "Threads User Info",
  "version": "1.0",
  "permissions": ["storage"],
  "host_permissions": ["https://www.threads.com/*"],
  "content_scripts": [{
    "matches": ["https://www.threads.com/*"],
    "js": ["content.js"],
    "css": ["styles.css"]
  }],
  "background": {
    "service_worker": "background.js"
  }
}
```
