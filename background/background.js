// 后台脚本，负责监听复制事件和管理数据

// 初始化
chrome.runtime.onInstalled.addListener(() => {
  // 创建上下文菜单
  chrome.contextMenus.create({
    id: 'copy-to-clipboard',
    title: '保存到万能粘贴板',
    contexts: ['selection']
  });
  
  // 侧边栏默认打开
  if (chrome.sidePanel) {
    chrome.sidePanel.setOptions({
      enabled: true,
      path: 'sidepanel/sidepanel.html'
    });
  }
});

// 监听命令
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle_side_panel') {
    // 切换侧边栏
    if (chrome.sidePanel) {
      chrome.sidePanel.open();
    }
  }
});

// 监听上下文菜单点击
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'copy-to-clipboard' && info.selectionText) {
    // 注入脚本获取富文本内容
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: getSelectionWithFormat
    }).then(results => {
      if (results && results[0] && results[0].result) {
        const { text, html, formats } = results[0].result;
        // 保存富文本内容到剪贴板
        saveToClipboard(text, html, formats);
      } else {
        // 如果无法获取富文本，则使用纯文本
        saveToClipboard(info.selectionText, info.selectionText);
      }
    }).catch(err => {
      console.error('获取选中内容失败:', err);
      // 错误时使用纯文本回退
      saveToClipboard(info.selectionText, info.selectionText);
    });
  }
});

// 这个函数在浏览器页面中执行，用于获取当前选中内容的富文本格式
function getSelectionWithFormat() {
  try {
    console.log('开始获取选中内容的格式');
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) {
      console.log('没有选中内容');
      return { text: '', html: '', formats: {} };
    }
    
    // 获取纯文本
    const text = selection.toString().trim();
    console.log('获取到纯文本:', text.substring(0, 50) + (text.length > 50 ? '...' : ''));
    
    // 获取HTML
    const range = selection.getRangeAt(0).cloneRange();
    const container = document.createElement('div');
    container.appendChild(range.cloneContents());
    const html = container.innerHTML;
    console.log('获取到HTML:', html.substring(0, 50) + (html.length > 50 ? '...' : ''));
    
    // 初始化格式对象
    const formats = {};
    
    // 默认设置格式类型
    formats.type = 'text';
    
    // 判断选中内容的类型
    try {
      const parentElement = selection.anchorNode?.parentElement;
      if (parentElement) {
        // 检测是否为Markdown
        const isInCodeBlock = parentElement.closest('pre, code') !== null;
        const isInMarkdownEditor = document.querySelector('.markdown-body, .markdown-editor, [data-mode="markdown"]') !== null;
        
        if (isInCodeBlock || isInMarkdownEditor) {
          formats.type = 'markdown';
          console.log('检测到内容类型: Markdown');
        }
        
        // 检测是否为JSON
        try {
          if (text && text.trim().startsWith('{') && text.trim().endsWith('}')) {
            JSON.parse(text);
            formats.type = 'json';
            console.log('检测到内容类型: JSON');
          }
        } catch (e) {
          console.log('JSON解析失败:', e.message);
        }
        
        // 获取字体和颜色信息
        try {
          const computedStyle = window.getComputedStyle(parentElement);
          formats.fontFamily = computedStyle.fontFamily;
          formats.fontSize = computedStyle.fontSize;
          formats.color = computedStyle.color;
          formats.backgroundColor = computedStyle.backgroundColor;
          formats.fontWeight = computedStyle.fontWeight;
          formats.fontStyle = computedStyle.fontStyle;
          formats.textDecoration = computedStyle.textDecoration;
          console.log('获取到样式信息:', 
                    `字体=${formats.fontFamily}, 大小=${formats.fontSize}, `+
                    `颜色=${formats.color}, 背景=${formats.backgroundColor}`);
        } catch (e) {
          console.log('获取样式失败:', e.message);
        }
      }
    } catch (e) {
      console.log('获取父元素失败:', e.message);
    }
    
    console.log('格式信息获取完成');
    return { text, html, formats };
  } catch (error) {
    console.error('获取富文本内容失败:', error);
    // 确保返回一个有效对象
    const text = window.getSelection()?.toString().trim() || '';
    return { text, html: text, formats: { type: 'text' } };
  }
}

// 保存到剪贴板历史记录
function saveToClipboard(text, html, formats = null) {
  // 没有文本内容则不保存
  if (!text || text.trim() === '') {
    return;
  }
  
  const timestamp = new Date().toISOString();
  const newItem = {
    text: text,
    html: html || text, // 如果没有提供HTML，则使用纯文本
    timestamp: timestamp,
    copyCount: 0,
    createdAt: timestamp,
    formats: formats || {} // 保存格式信息
  };

  chrome.storage.local.get({ clipboardItems: [] }, (result) => {
    const items = result.clipboardItems;
    
    // 检查是否已存在相同文本内容
    const existingIndex = items.findIndex(item => item.text === text);
    
    if (existingIndex >= 0) {
      // 已存在的项，更新时间戳、HTML内容和格式信息
      items[existingIndex].timestamp = timestamp;
      items[existingIndex].html = html || text;
      if (formats) {
        items[existingIndex].formats = formats;
      }
    } else {
      // 新项，添加到数组开头
      items.unshift(newItem);
    }
    
    // 限制保存的项数，最多保存100项
    const limitedItems = items.slice(0, 100);
    
    chrome.storage.local.set({ clipboardItems: limitedItems });
  });
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'saveToClipboard') {
    console.log('收到保存请求:', request);
    saveToClipboard(request.text, request.html, request.formats);
  }
});

// 监听来自popup或sidepanel的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getClipboardItems') {
    chrome.storage.local.get({ clipboardItems: [] }, (result) => {
      sendResponse({ items: result.clipboardItems });
    });
    return true; // 保持消息通道打开，等待异步响应
  }
  
  if (request.action === 'incrementCopyCount') {
    updateCopyCount(request.text);
  }
  
  if (request.action === 'paste') {
    // 转发粘贴消息到当前活动标签页
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, {
          action: 'paste',
          text: request.text,
          html: request.html || request.text
        }, (response) => {
          sendResponse(response);
        });
      } else {
        sendResponse({ success: false, error: '无法找到活动标签页' });
      }
    });
    return true; // 保持消息通道打开，等待异步响应
  }
  
  if (request.action === 'openSidePanel') {
    if (chrome.sidePanel) {
      // 使用正确的参数格式调用 sidePanel.open
      chrome.sidePanel.open({ windowId: chrome.windows.WINDOW_ID_CURRENT }, () => {
        sendResponse({ success: true });
      });
    } else {
      sendResponse({ success: false, error: '不支持侧边栏' });
    }
    return true;
  }
});

// 监听扩展安装或更新事件，自动打开侧边栏
chrome.runtime.onInstalled.addListener(() => {
  if (chrome.sidePanel) {
    chrome.sidePanel.setOptions({
      enabled: true,
      path: 'sidepanel/sidepanel.html'
    });
  }
});

// 监听扩展图标点击事件，打开侧边栏而不是弹出窗口
chrome.action.onClicked.addListener((tab) => {
  if (chrome.sidePanel) {
    chrome.sidePanel.open({ windowId: tab.windowId });
  }
});

// 更新复制次数
function updateCopyCount(text) {
  chrome.storage.local.get({ clipboardItems: [] }, (result) => {
    const items = result.clipboardItems;
    const index = items.findIndex(item => item.text === text);
    
    if (index >= 0) {
      items[index].copyCount += 1;
      chrome.storage.local.set({ clipboardItems: items });
    }
  });
} 