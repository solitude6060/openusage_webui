# UI / UX Review & Improvement Plan

> Date: 2026-06-28
> Reviewer: Antigravity
> Scope: WebUI (React Frontend) UI/UX and Codebase Organization

## 1. 架構與程式碼組織 (Architecture & Codebase Organization)

目前前端架構將所有邏輯集中於單一檔案，導致難以維護且違反專案開發規範。

*   **檔案過度龐大**：`apps/web/src/App.tsx` 檔案總長度超過 970 行，違反專案規範中的 `<~500 LOC` 限制。
    *   **改進方案**：將路由與頁面拆分至 `src/pages/`（如 `DashboardPage.tsx`, `ProvidersPage.tsx`, `SessionsPage.tsx`, `SettingsPage.tsx`）。
    *   **改進方案**：將共用元件拆分至 `src/components/`（如 `Sidebar.tsx`, `UsageCard.tsx`, `UsageLine.tsx`）。
*   **違規依賴套件**：`package.json` 中包含 `lucide-react`，違反專案規範中強制使用 `@hugeicons-pro/core-solid-rounded` 的要求。目前介面也缺乏圖示輔助。
    *   **改進方案**：移除 `lucide-react` 依賴，並於介面全面導入 Hugeicons。

## 2. 視覺設計與美學 (Visual Design & Aesthetics)

目前的介面設計（由 `styles.css` 驅動）過於平面與實用導向，缺乏現代 Web 應用程式的精緻感（Premium Feel），不符合設計最佳實踐的要求。

*   **扁平與缺乏層次**：色彩變數（`--paper`, `--canvas`）與實線邊框（`1px solid var(--line)`）設計過於基礎。
    *   **改進方案（色彩系統）**：捨棄純色填充，改用帶有環境光暈（ambient glow）的深色漸層背景。
    *   **改進方案（玻璃擬物化）**：區塊容器改用低透明度背景（例如 `rgba(255, 255, 255, 0.03)`）配合背景模糊（`backdrop-filter: blur(24px)`），並疊加 1px 的內高光（`box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05)`）來界定邊緣，建立更豐富的空間層級。
*   **字體與排版**：目前字體層級雖然清晰，但在高解析度下略顯單薄。
    *   **改進方案**：引入現代無襯線字型（如 Inter 或 Outfit）的 Variable Font 特性，針對數字（Tabular Nums）進行最佳化，並增加標題與數值的對比度。
    *   **改進方案**：落實專案規範，確保所有寫死的標題文案皆使用 Title Case（例如將潛在的 "Local dashboard" 確保為 "Local Dashboard"）。

## 3. 互動與使用者體驗 (Interaction & User Experience)

目前的操作回饋較為生硬，缺乏動態提示與微互動（Micro-animations）。

*   **導覽列與轉場缺乏動態**：切換頁面與點擊按鈕時只有基本的顏色變化與縮放。
    *   **改進方案**：在側邊欄（Sidebar）加入圖示，並為活躍狀態（Active State）實作左側的高亮指示條（indicator bar）或帶有主題色的文字發光效果，取代單純的背景色切換。
    *   **改進方案**：導入 View Transitions API 或基本的 CSS 淡入淡出動畫，使頁面切換更加流暢。
    *   **改進方案**：將頂部控制列（Topbar）過度突兀的實體 "Refresh All" 按鈕改為整合於標題右側的高質感圖示按鈕，或使用具備背景模糊的浮動操作按鈕（FAB）。
*   **資料載入與狀態回饋**：進度條（`.usage-progress-fill`）與錯誤訊息（`.alert`）的呈現方式過於直接，錯誤訊息會推擠畫面佈局。
    *   **改進方案**：將靜態的提示訊息改為懸浮的 Toast 通知系統。
    *   **改進方案**：為用量進度條載入加入發光效果（Glowing Progress Bars）。例如改用平滑漸層色彩並加入對應色彩的發光陰影（`box-shadow: 0 0 12px var(--accent)`）。超過 90% 時轉為紅色脈衝動畫（pulse animation）。
    *   **改進方案**：為卡片排序（DnD）或表格 Hover 狀態加入 `transform: translateY(-2px)` 與擴展的下落陰影（drop shadow），提供明確物理反饋。
*   **資料表單（Sessions 頁面）體驗**：現有表格（Table）在小尺寸視窗下容易擁擠，過濾器（Filter Bar）排版緊密。
    *   **改進方案**：增加表格儲存格內距（padding），將表頭（`thead`）的視覺比重與邊框降低（使用次要色系），引導視線聚焦於實際數據數值上。
    *   **改進方案**：重新設計 Sessions 頁面的 Filter Bar 配置，並將表格優化為具備響應式捲動或分頁功能的元件。

## 4. 執行路徑 (Execution Steps)

1.  **Phase 1: 依賴與結構重構**
    *   執行 `bun remove lucide-react` 並確認無殘留。
    *   拆分 `App.tsx`，建立 `src/pages` 與 `src/components` 目錄。
2.  **Phase 2: 基礎 UI 升級**
    *   將 `@hugeicons-pro/core-solid-rounded` 圖示整合至側邊欄、設定頁面與狀態指示器。
    *   改寫 `styles.css`，注入高質感的色彩變數、發光進度條、陰影層級與 Glassmorphism 效果。
3.  **Phase 3: 互動體驗增強**
    *   實作 Toast 通知系統取代目前的內嵌 `.alert`。
    *   優化 Provider 拖曳卡片的動畫過渡與 hover 狀態，加入實體反饋（位移與陰影變化）。
    *   優化 Sessions 頁面表格佈局（降低表頭比重）與響應式設計。
