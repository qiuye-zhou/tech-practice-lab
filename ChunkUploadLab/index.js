class controlsUploader {
  constructor(maxCount = 5) {
    this.maxCount = maxCount; // 最大并发数
    this.queue = []; // 待上传任务队列
    this.activeCount = 0; // 当前活活跃任务数
    this.paused = false; // 是否暂停
  }

  addTask(task) {
    this.queue.push(task);
    this.run();
  }

  async run() {
    if (this.activeCount >= this.maxCount || this.queue.length === 0 || this.paused) {
      return;
    }

    const task = this.queue.shift();
    this.activeCount++;

    try {
      await task();
    } catch (error) {
      console.error(error);
    } finally {
      this.activeCount--;
      this.run();
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
    this.run();
  }

  clear() {
    this.queue = [];
    this.activeCount = 0;
    this.paused = false;
  }
}

// 分片大小
const chunkSize = 1024 * 1024;

const uploadFileContainer = document.getElementById('uploadFileContainer');
const fileInput = document.getElementById('fileInput');
const overallProgress = document.getElementById('overallProgress');
const overallProgressBar = document.getElementById('overallProgressBar');
const currentChunk = document.getElementById('currentChunk');
const currentChunkProgressBar = document.getElementById('currentChunkProgressBar');
const pauseBtn = document.getElementById('pauseBtn');
const resumeBtn = document.getElementById('resumeBtn');
const cancelBtn = document.getElementById('cancelBtn');
const status = document.getElementById('status');
const chunkUploadResultsList = document.getElementById('chunkUploadResultsList');

let currentFile = null;
let fileId = null;
let fileHash = '';
let uploader = new controlsUploader(3);
let uploadedChunks = new Set();

fileInput.addEventListener('change', (event) => {
  const file = event.target.files[0];
  if (file) {
    startUpload(file);
  }
});
uploadFileContainer.addEventListener('dragover', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadFileContainer.classList.add('dragover');
});
uploadFileContainer.addEventListener('drop', (event) => {
  event.preventDefault();
  event.stopPropagation();
  uploadFileContainer.classList.remove('dragover');
  const file = event.dataTransfer.files[0];
  if (file) {
    startUpload(file);
  }
});
pauseBtn.addEventListener('click', () => {
  uploader.pause();
  pauseBtn.disabled = true;
  resumeBtn.disabled = false;
  showStatus('上传已暂停', 'info');
});
resumeBtn.addEventListener('click', () => {
  uploader.resume();
  pauseBtn.disabled = false;
  resumeBtn.disabled = true;
  showStatus('上传已继续', 'info');
});
cancelBtn.addEventListener('click', () => {
  uploader.clear();
  uploader.paused = false;
  resetUI();
  showStatus('上传已取消', 'error');
});

// 上传文件逻辑
async function startUpload(file) {
  currentFile = file;
  fileId = generateFileId();
  uploadedChunks.clear();

  showStatus(`开始上传文件: ${file.name}`, 'info');
  pauseBtn.disabled = false;
  cancelBtn.disabled = false;
  fileHash = await calculateFileHash(file);

  try {
    const response = await fetch('/upload-file-exists', {
      method: 'POST',
      body: JSON.stringify({
        fileHash,
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    });
    const data = await response.json();
    if (response.ok) {
      if (data.exists) {
        showStatus('文件已存在，秒传成功！', 'success');
        resetUI();
        return;
      }
    }
  } catch (error) {
    console.log('秒传检查失败，继续正常上传');
  }

  const totalChunks = Math.ceil(file.size / chunkSize);
  overallProgressBar.max = totalChunks;
  updateProgress();

  const localChunks = localStorage.getItem(`uploadedChunks_${fileId}`);
  if (localChunks) {
    JSON.parse(localChunks).forEach(index => uploadedChunks.add(index));
  }

  try {
    const response = await fetch(`/upload-file-status/${fileId}`, { method: 'GET' });
    const data = await response.json();
    if (response.ok) {
      data.uploadedChunks.forEach(index => uploadedChunks.add(index));
      localStorage.setItem(`uploadedChunks_${fileId}`, JSON.stringify([...uploadedChunks]));
    }
  } catch (error) {
    console.log('无法获取上传状态，重新开始上传');
  }

  for (let i = 0; i < totalChunks; i++) {
    if (!uploadedChunks.has(i)) {
      const start = i * chunkSize;
      const chunk = file.slice(start, Math.min(file.size, start + chunkSize));
      uploader.addTask(() => uploadChunk(chunk, i, totalChunks));
    }
  }
}

// 上传单个分片请求逻辑
async function uploadChunk(chunk, index, totalChunks) {
  if (uploadedChunks.has(index)) {
    return;
  }
  currentChunk.textContent = `${index + 1}/${totalChunks}`;
  currentChunkProgressBar.value = 0;
  try {
    const formData = new FormData();
    formData.append('file', chunk);
    formData.append('fileId', fileId);
    formData.append('chunkIndex', index);
    formData.append('totalChunks', totalChunks);

    const response = await fetch('/upload-chunk', {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();
    if (response.ok) {
      uploadedChunks.add(index);
      localStorage.setItem(`uploadedChunks_${fileId}`, JSON.stringify([...uploadedChunks]));
      updateProgress();
      const listItem = document.createElement('li');
      listItem.textContent = `分片 ${data.chunkIndex + 1}/${data.totalChunks} 上传成功 (文件ID: ${data.fileId})`;
      listItem.style.color = 'green';
      chunkUploadResultsList.appendChild(listItem);

      if (uploadedChunks.size === totalChunks) {
        await mergeChunks();
      }
    } else {
      const listItem = document.createElement('li');
      listItem.textContent = `分片 ${index + 1}/${totalChunks} 上传失败`;
      listItem.style.color = 'red';
      chunkUploadResultsList.appendChild(listItem);
      throw new Error('上传分片失败');
    }
  } catch (error) {
    showStatus(`上传分片 ${index} 出错: ${error.message}`, 'error');
    // 从已上传列表中移除失败的分片，允许重试
    uploadedChunks.delete(index);
    localStorage.setItem(`uploadedChunks_${fileId}`, JSON.stringify([...uploadedChunks]));
    throw new Error(`上传分片出错: ${error.message}`);
  }
}

// 合并分片请求逻辑
async function mergeChunks() {
  try {
    const response = await fetch('/merge', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
        fileHash,
        fileName: currentFile.name,
      }),
    });
    const data = await response.json();
    if (response.ok) {
      showStatus('文件上传成功', 'success');
      resetUI();
    } else {
      throw new Error('合并文件失败');
    }
  } catch (error) {
    showStatus(`合并文件出错: ${error.message}`, 'error');
  }
}

// 生成唯一文件ID
function generateFileId() {
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// 计算文件Hash(实现秒传功能)
async function calculateFileHash(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const buffer = event.target.result;
      crypto.subtle.digest('SHA-256', buffer).then((hashBuffer) => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
        resolve(hashHex);
      }).catch((error) => {
        reject(error);
      });
    };
    reader.readAsArrayBuffer(file);
  });
}

// 更新上传进度
function updateProgress() {
  const progress = uploadedChunks.size;
  const totalChunk = Math.ceil(currentFile.size / (chunkSize));
  overallProgress.textContent = `${Math.round((progress / totalChunk) * 100)}%`;
  overallProgressBar.value = progress;
}

// 更新显示状态
function showStatus(message, type) {
  status.textContent = message;
  status.className = 'status ' + type;
}

// 重置UI
function resetUI() {
  pauseBtn.disabled = true;
  resumeBtn.disabled = true;
  cancelBtn.disabled = true;
  currentChunk.textContent = '';
  currentChunkProgressBar.value = 0;
  overallProgress.textContent = '';
  overallProgressBar.value = 0;
  chunkUploadResultsList.innerHTML = '';
}