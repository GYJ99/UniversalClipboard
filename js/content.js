// 监听复制事件
document.addEventListener('copy', () => {
  // 使用setTimeout来确保浏览器已经处理了复制事件
  setTimeout(() => {
    try {
      // 获取选中的文本（纯文本）
      const selection = window.getSelection();
      const selectedText = selection.toString().trim();
      
      if (selectedText) {
        // 尝试获取HTML格式的内容
        let htmlContent = '';
        if (document.queryCommandSupported('copy')) {
          // 创建一个临时容器来获取富文本内容
          const tempDiv = document.createElement('div');
          
          // 获取选中的范围
          if (selection.rangeCount > 0) {
            const range = selection.getRangeAt(0).cloneRange();
            tempDiv.appendChild(range.cloneContents());
            htmlContent = tempDiv.innerHTML;
          }
        }
        
        // 获取格式信息
        const formats = {};
        try {
          // 默认设置格式类型
          formats.type = 'text';
          
          // 检测选中内容的类型
          const parentElement = selection.anchorNode?.parentElement;
          if (parentElement) {
            // 检测是否为Markdown
            const isInCodeBlock = parentElement.closest('pre, code') !== null;
            const isInMarkdownEditor = document.querySelector('.markdown-body, .markdown-editor, [data-mode="markdown"]') !== null;
            
            if (isInCodeBlock || isInMarkdownEditor) {
              formats.type = 'markdown';
            }
            
            // 检测是否为JSON
            try {
              if (selectedText && selectedText.trim().startsWith('{') && selectedText.trim().endsWith('}')) {
                JSON.parse(selectedText);
                formats.type = 'json';
              }
            } catch {}
            
            // 获取样式信息
            const computedStyle = window.getComputedStyle(parentElement);
            formats.fontFamily = computedStyle.fontFamily;
            formats.fontSize = computedStyle.fontSize;
            formats.color = computedStyle.color;
            formats.backgroundColor = computedStyle.backgroundColor;
            formats.fontWeight = computedStyle.fontWeight;
            formats.fontStyle = computedStyle.fontStyle;
            formats.textDecoration = computedStyle.textDecoration;
          }
        } catch (e) {
          console.error('获取格式信息失败:', e);
        }
        
        // 将选中的文本、HTML内容和格式信息发送到后台脚本
        chrome.runtime.sendMessage({
          action: 'saveToClipboard',
          text: selectedText,
          html: htmlContent || selectedText, // 如果没有HTML，则使用纯文本
          formats: formats
        });
      }
    } catch (error) {
      console.error('处理复制事件时出错:', error);
    }
  }, 100);
});

// 尝试从剪贴板API获取富文本内容（当可用时）
document.addEventListener('copy', async () => {
  try {
    // 检查Clipboard API是否可用
    if (navigator.clipboard && navigator.clipboard.read) {
      // 等待一段时间，确保系统剪贴板已更新
      setTimeout(async () => {
        try {
          const clipboardItems = await navigator.clipboard.read();
          for (const item of clipboardItems) {
            // 处理纯文本
            if (item.types.includes('text/plain')) {
              const blob = await item.getType('text/plain');
              const text = await blob.text();
              
              // 处理HTML（如果有）
              let html = null;
              if (item.types.includes('text/html')) {
                const htmlBlob = await item.getType('text/html');
                html = await htmlBlob.text();
              }
              
              // 发送到后台
              if (text.trim()) {
                chrome.runtime.sendMessage({
                  action: 'saveToClipboard',
                  text: text.trim(),
                  html: html || text.trim()
                });
              }
              break;
            }
          }
        } catch (e) {
          // 剪贴板API访问可能被拒绝，使用备用方法
          console.log('无法直接访问剪贴板API内容:', e);
          // 已经通过之前的方法处理过了，这里只是记录错误
        }
      }, 100);
    }
  } catch (e) {
    console.log('Clipboard API不可用:', e);
  }
});

// 定义全局变量记录上次鼠标点击位置
let lastClickX = 0;
let lastClickY = 0;

// 监听鼠标点击事件，记录最后一次点击位置
document.addEventListener('mousedown', (e) => {
  lastClickX = e.clientX;
  lastClickY = e.clientY;
});

// 监听从后台的消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'paste') {
    // 先检查当前活动元素
    let targetElement = document.activeElement;
    let success = false;
    
    // 如果没有合适的活动元素，尝试在鼠标位置找到一个可编辑的元素
    if (!targetElement || 
        (targetElement.tagName !== 'INPUT' && 
         targetElement.tagName !== 'TEXTAREA' && 
         !targetElement.isContentEditable)) {
      
      // 使用最后一次鼠标点击位置查找附近的输入元素
      const elementsAtPoint = document.elementsFromPoint(lastClickX, lastClickY);
      
      // 遍历元素找到第一个可编辑的
      for (const el of elementsAtPoint) {
        if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) {
          targetElement = el;
          // 模拟点击该元素以获取焦点
          targetElement.focus();
          break;
        }
      }
      
      // 如果还是没找到，使用更广泛的搜索
      if (!targetElement || 
          (targetElement.tagName !== 'INPUT' && 
           targetElement.tagName !== 'TEXTAREA' && 
           !targetElement.isContentEditable)) {
        
        // 大范围扫描文档中的所有可编辑元素
        const inputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), textarea, [contenteditable="true"]');
        
        if (inputs.length > 0) {
          // 找到最接近鼠标的元素
          let closestEl = null;
          let closestDistance = Number.MAX_SAFE_INTEGER;
          
          inputs.forEach(input => {
            const rect = input.getBoundingClientRect();
            const centerX = rect.left + rect.width / 2;
            const centerY = rect.top + rect.height / 2;
            const distance = Math.sqrt(
              Math.pow(centerX - lastClickX, 2) + 
              Math.pow(centerY - lastClickY, 2)
            );
            
            if (distance < closestDistance) {
              closestDistance = distance;
              closestEl = input;
            }
          });
          
          if (closestEl) {
            targetElement = closestEl;
            // 模拟点击该元素以获取焦点
            targetElement.focus();
          }
        }
      }
    }
    
    // 如果找到了目标元素，执行粘贴操作
    if (targetElement && 
        (targetElement.tagName === 'INPUT' || 
         targetElement.tagName === 'TEXTAREA' || 
         targetElement.isContentEditable)) {
      
      // 根据目标元素类型决定粘贴纯文本还是HTML
      if (targetElement.isContentEditable) {
        // 对于富文本编辑器，尝试粘贴HTML
        if (request.html && request.html !== request.text) {
          // 插入HTML内容
          document.execCommand('insertHTML', false, request.html);
        } else {
          // 如果没有HTML格式或HTML与纯文本相同，则插入纯文本
          document.execCommand('insertText', false, request.text);
        }
        success = true;
      } else {
        // 对于普通文本输入框，只能粘贴纯文本
        try {
          // 获取当前光标位置
          const startPos = targetElement.selectionStart;
          const endPos = targetElement.selectionEnd;
          
          // 插入文本
          const currentValue = targetElement.value;
          targetElement.value = currentValue.substring(0, startPos) + 
                               request.text + 
                               currentValue.substring(endPos);
          
          // 移动光标到文本末尾
          targetElement.selectionStart = targetElement.selectionEnd = 
            startPos + request.text.length;
          
          success = true;
        } catch (e) {
          console.error('粘贴时发生错误:', e);
        }
      }
    }
    
    if (success) {
      sendResponse({ success: true });
    } else {
      // 如果上述方法都失败，尝试使用模拟键盘事件
      // 先将内容复制到剪切板
      copyToClipboard(request.text, request.html);
      
      // 模拟键盘快捷键 Ctrl+V 或 Command+V
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? 'metaKey' : 'ctrlKey';
      
      // 创建并分发键盘事件
      const pasteEvent = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        keyCode: 86, // V 键的键码
        [modKey]: true
      });
      
      // 尝试派发事件到文档或活动元素
      if (document.activeElement) {
        document.activeElement.dispatchEvent(pasteEvent);
      } else {
        document.dispatchEvent(pasteEvent);
      }
      
      sendResponse({ success: true, method: 'keyboard-simulation' });
    }
    
    return true;
  }
});

// 辅助函数：复制内容到剪切板
function copyToClipboard(text, html) {
  // 使用现代剪切板 API
  if (navigator.clipboard && navigator.clipboard.write) {
    const clipboardItem = new ClipboardItem({
      'text/plain': new Blob([text], { type: 'text/plain' }),
      ...(html ? { 'text/html': new Blob([html], { type: 'text/html' }) } : {})
    });
    navigator.clipboard.write([clipboardItem]).catch(e => {
      console.error('复制到剪切板失败:', e);
    });
    return;
  }
  
  // 后备方法：编程式复制
  const tempInput = document.createElement('textarea');
  tempInput.value = text;
  document.body.appendChild(tempInput);
  tempInput.select();
  document.execCommand('copy');
  document.body.removeChild(tempInput);
}
 