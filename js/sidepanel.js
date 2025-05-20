// DOM 元素
const clipboardListEl = document.getElementById('clipboard-list');
const searchInputEl = document.getElementById('search-input');
const clearAllBtnEl = document.getElementById('clear-all-btn');
const clipboardItemTemplate = document.getElementById('clipboard-item-template');
const welcomeTipEl = document.getElementById('welcome-tip');
const closeTipBtnEl = document.getElementById('close-tip-btn');

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  // 加载剪贴板项
  loadClipboardItems();
  
  // 事件监听
  searchInputEl.addEventListener('input', handleSearch);
  clearAllBtnEl.addEventListener('click', handleClearAll);
  
  // 欢迎提示的关闭按钮
  if (closeTipBtnEl) {
    closeTipBtnEl.addEventListener('click', () => {
      if (welcomeTipEl) {
        welcomeTipEl.classList.add('hidden');
        // 将关闭状态保存到存储中，下次不再显示
        chrome.storage.local.set({ welcomeTipClosed: true });
      }
    });
  }
  
  // 检查是否需要显示欢迎提示
  chrome.storage.local.get({ welcomeTipClosed: false }, (result) => {
    if (result.welcomeTipClosed && welcomeTipEl) {
      welcomeTipEl.classList.add('hidden');
    }
  });
  
  // 定期刷新列表，以显示最新的复制内容
  setInterval(() => {
    const searchText = searchInputEl.value.trim();
    loadClipboardItems(searchText);
  }, 3000);
});

// 加载剪贴板项
function loadClipboardItems(searchText = '') {
  chrome.runtime.sendMessage({ action: 'getClipboardItems' }, (response) => {
    renderClipboardItems(response.items, searchText);
  });
}

// 渲染剪贴板项列表
function renderClipboardItems(items, searchText = '') {
  // 保存滚动位置
  const scrollPosition = clipboardListEl.scrollTop;
  
  // 清空列表
  clipboardListEl.innerHTML = '';
  
  // 过滤项
  let filteredItems = items;
  if (searchText) {
    const searchLower = searchText.toLowerCase();
    filteredItems = items.filter(item => 
      item.text.toLowerCase().includes(searchLower)
    );
  }
  
  // 显示空状态
  if (filteredItems.length === 0) {
    const emptyEl = document.createElement('div');
    emptyEl.className = 'empty-state';
    emptyEl.textContent = searchText 
      ? '没有找到匹配的内容' 
      : '你的复制粘贴板是空的';
    clipboardListEl.appendChild(emptyEl);
    return;
  }
  
  // 填充列表
  filteredItems.forEach(item => {
    const itemEl = createClipboardItemElement(item);
    clipboardListEl.appendChild(itemEl);
  });
  
  // 恢复滚动位置
  clipboardListEl.scrollTop = scrollPosition;
}

// 创建剪贴板项元素
function createClipboardItemElement(item) {
  // 使用模板克隆元素
  const template = clipboardItemTemplate.content.cloneNode(true);
  const itemEl = template.querySelector('.clipboard-item');
  
  // 填充内容 - 使用HTML内容（如果存在）
  const contentEl = itemEl.querySelector('.clipboard-content');
  const contentPreviewEl = contentEl.querySelector('.content-preview');
  
  if (contentPreviewEl) {
    if (item.html && item.html !== item.text) {
      // 使用HTML内容
      contentPreviewEl.innerHTML = sanitizeHTML(item.html);
      
      // 为链接增加目标属性，避免在弹出窗口中打开
      const links = contentPreviewEl.querySelectorAll('a');
      links.forEach(link => {
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
      });
    } else {
      // 纯文本回退
      contentPreviewEl.textContent = item.text;
    }
  } else {
    // 兼容旧版模板
    contentEl.textContent = item.text;
  }
  
  // 格式化时间
  const date = new Date(item.timestamp);
  const formattedDate = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`;
  itemEl.querySelector('.clipboard-time').textContent = formattedDate;
  
  // 复制次数
  itemEl.querySelector('.clipboard-copy-count span').textContent = item.copyCount;
  
  // 复制按钮事件
  const copyBtn = itemEl.querySelector('.copy-btn');
  copyBtn.addEventListener('click', () => {
    copyToClipboard(item.text, item.html);
    updateCopyCount(item.text);
    showFeedback(copyBtn, '✓');
  });
  
  // 粘贴按钮事件
  const pasteBtn = itemEl.querySelector('.paste-btn');
  pasteBtn.addEventListener('click', () => {
    pasteToCurrent(item.text, item.html, pasteBtn);
  });
  
  // 删除按钮事件
  const deleteBtn = itemEl.querySelector('.delete-btn');
  deleteBtn.addEventListener('click', () => {
    deleteClipboardItem(item.text);
  });
  
  return itemEl;
}

// 安全地处理HTML内容，防止XSS攻击
function sanitizeHTML(html) {
  // 创建一个安全的HTML过滤器
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  // 删除所有脚本标签
  const scripts = temp.querySelectorAll('script');
  scripts.forEach(script => script.remove());
  
  // 删除所有可执行的属性
  const allElements = temp.querySelectorAll('*');
  allElements.forEach(el => {
    // 移除所有on*事件
    for (const attr of el.attributes) {
      if (attr.name.startsWith('on') || attr.value.includes('javascript:')) {
        el.removeAttribute(attr.name);
      }
    }
  });
  
  return temp.innerHTML;
}

// 复制到系统剪贴板
function copyToClipboard(text, html) {
  // 如果支持富文本复制，则同时复制富文本和纯文本
  if (html && html !== text && navigator.clipboard && navigator.clipboard.write) {
    try {
      const clipboardItem = new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' })
      });
      
      navigator.clipboard.write([clipboardItem])
        .catch(err => {
          console.error('富文本复制失败，回退到纯文本:', err);
          navigator.clipboard.writeText(text);
        });
    } catch (e) {
      // 如果ClipboardItem不支持，回退到纯文本
      navigator.clipboard.writeText(text)
        .catch(err => console.error('复制失败:', err));
    }
  } else {
    // 纯文本复制
    navigator.clipboard.writeText(text)
      .catch(err => console.error('复制失败:', err));
  }
}

// 更新复制次数
function updateCopyCount(text) {
  chrome.runtime.sendMessage({ 
    action: 'incrementCopyCount', 
    text: text 
  });
  
  // 重新加载以更新UI
  setTimeout(() => {
    loadClipboardItems(searchInputEl.value);
  }, 300);
}

// 粘贴到当前活动元素
function pasteToCurrent(text, html, button) {
  // 首先将内容复制到系统剪贴板
  copyToClipboardAndThenPaste(text, html, button);
}

// 复制到剪贴板并模拟粘贴操作
async function copyToClipboardAndThenPaste(text, html, button) {
  try {
    // 复制内容到剪贴板
    await navigator.clipboard.writeText(text);
    
    // 如果支持富文本复制，同时复制HTML
    if (html && html !== text && navigator.clipboard.write) {
      try {
        const clipboardItem = new ClipboardItem({
          'text/plain': new Blob([text], { type: 'text/plain' }),
          'text/html': new Blob([html], { type: 'text/html' })
        });
        await navigator.clipboard.write([clipboardItem]);
      } catch (e) {
        console.error('复制HTML内容失败:', e);
        // 继续使用纯文本复制
      }
    }
    
    // 尝试执行粘贴操作 - 使用浏览器API
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs.length > 0) {
        // 尝试执行指令
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tabs[0].id },
            function: () => {
              // 尝试驱动粘贴操作
              const activeElement = document.activeElement;
              if (activeElement && (activeElement.isContentEditable || 
                  activeElement.tagName === 'INPUT' || 
                  activeElement.tagName === 'TEXTAREA')) {
                // 尝试使用文档粘贴API
                document.execCommand('paste');
              } else {
                // 如果没有活动的输入元素，显示提示
                alert('请先点击要粘贴的位置！');
              }
            }
          });
          showFeedback(button, '✓');
        } catch (error) {
          console.error('执行粘贴失败:', error);
          // 显示复制成功但需要手动粘贴的提示
          showFeedback(button, 'ⓘ', true);
          // 显示小提示
          alert('内容已复制到剪贴板，请手动粘贴 (Ctrl+V 或 Cmd+V)');
        }
      } else {
        showFeedback(button, '✗', true);
      }
    });
  } catch (error) {
    console.error('剪贴板操作失败:', error);
    showFeedback(button, '✗', true);
  }
}

// 显示操作反馈
function showFeedback(button, message, isError = false) {
  const originalText = button.textContent;
  button.textContent = message;
  if (isError) {
    button.style.backgroundColor = '#ff5722';
  }
  button.disabled = true;
  
  setTimeout(() => {
    button.textContent = originalText;
    if (isError) {
      button.style.backgroundColor = '';
    }
    button.disabled = false;
  }, 1500);
}

// 删除剪贴板项
function deleteClipboardItem(text) {
  chrome.storage.local.get({ clipboardItems: [] }, (result) => {
    const items = result.clipboardItems;
    const filteredItems = items.filter(item => item.text !== text);
    
    chrome.storage.local.set({ clipboardItems: filteredItems }, () => {
      loadClipboardItems(searchInputEl.value);
    });
  });
}

// 处理搜索
function handleSearch() {
  const searchText = searchInputEl.value.trim();
  loadClipboardItems(searchText);
}

// 处理清空全部
function handleClearAll() {
  if (confirm('确定要清空所有记录吗？')) {
    chrome.storage.local.set({ clipboardItems: [] }, () => {
      loadClipboardItems();
    });
  }
} 