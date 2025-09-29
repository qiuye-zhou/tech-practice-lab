const express = require('express');
const path = require('path');
const multer = require('multer');
const fs = require('fs').promises;
const fsSync = require('fs');

const app = express();
const port = 3000;

const uploadDir = path.join(__dirname, 'uploads');
const chunksDir = path.join(uploadDir, 'chunks');

// 确保上传目录和分片目录存在
const ensureUploadDirs = async () => {
  await fs.mkdir(uploadDir, { recursive: true });
  await fs.mkdir(chunksDir, { recursive: true });
};

// 配置 multer 中间件
const storage = multer.diskStorage({
  destination: async function (req, file, cb) {
    await ensureUploadDirs();
    // 指定分片存储目录
    cb(null, chunksDir);
  },
  // 定义文件名生成规则
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

app.use(express.static('.'));

// 上传分片接口
app.post('/upload-chunk', upload.single('file'), async (req, res) => {
  try {
    const { fileId, chunkIndex, totalChunks } = req.body;
    if (!req.file) {
      return res.status(400).json({ error: '没有上传文件' });
    }

    // 重命名文件以包含 fileId 和 chunkIndex，方便后续合并
    const oldPath = req.file.path;
    const newPath = path.join(path.dirname(oldPath), `${fileId}-${chunkIndex}`);

    await fs.rename(oldPath, newPath);

    console.log(`Uploaded chunk ${parseInt(chunkIndex) + 1}/${totalChunks} for file ${fileId}`);

    // 返回上传成功的响应
    res.json({
      success: true,
      chunkIndex: parseInt(chunkIndex),
      totalChunks: parseInt(totalChunks),
      fileId: fileId
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: '上传分片失败' });
  }
});

// 合并分片接口
app.post('/merge', express.json(), async (req, res) => {
  try {
    const { fileId, fileName, fileHash } = req.body;
    if (!fileHash) {
      return res.status(400).json({ error: '缺少 fileHash 参数' });
    }

    const chunksDir = path.join(__dirname, 'uploads', 'chunks');
    const targetPath = path.join(__dirname, 'uploads', fileName);

    const files = await fs.readdir(chunksDir);
    const chunkFiles = files
      .filter(file => file.startsWith(fileId + '-'))
      .map(file => {
        const chunkIndex = parseInt(file.split('-')[1]);
        return { index: chunkIndex, name: file };
      })
      .sort((a, b) => a.index - b.index);

    // 创建写入流，用于合并文件
    const writeStream = fsSync.createWriteStream(targetPath);

    // 按顺序合并分片
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunksDir, chunkFile.name);
      const chunkData = await fs.readFile(chunkPath);
      writeStream.write(chunkData);
    }

    writeStream.end();

    // 等待写入完成
    await new Promise((resolve) => {
      writeStream.on('finish', resolve);
    });

    // 合并完成后删除分片文件
    for (const chunkFile of chunkFiles) {
      await fs.unlink(path.join(chunksDir, chunkFile.name));
    }

    // 创建或更新存在的文件元数据
    const metadataPath = path.join(uploadDir, 'file-metadata.json');
    let metadata = {};

    try {
      metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
    } catch (err) {
      // 文件不存在或无内容
    }

    // 添加新文件的元数据
    metadata[fileName] = fileHash;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    console.log(`File ${fileName} merged successfully`);
    res.json({ success: true });
  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({ error: '合并文件失败' });
  }
});

// 检查文件是否已存在
app.post('/upload-file-exists', express.json(), async (req, res) => {
  try {
    const { fileHash } = req.body;

    // 确保 uploads 目录存在
    await ensureUploadDirs();

    // 检查文件是否已存在
    const metadataPath = path.join(uploadDir, 'file-metadata.json');
    let exists = false;

    try {
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8'));
      exists = Object.values(metadata).includes(fileHash);
    } catch (err) {
      // 文件不存在或无内容
    }

    res.json({ exists });
  } catch (error) {
    console.error('检查文件失败:', error);
    res.status(500).json({ error: '检查文件失败', details: error.message });
  }
});

// 获取上传状态
app.get('/upload-file-status/:fileId', async (req, res) => {
  try {
    const fileId = req.params.fileId;
    const chunksDir = path.join(__dirname, 'uploads', 'chunks');
    const filePath = path.join(__dirname, 'uploads', fileId);

    // 检查文件是否已存在
    try {
      await fs.access(filePath);
      return res.json({ uploadedChunks: [], completed: true });
    } catch {
      // 文件不存在，继续检查分片
    }

    // 查找相关分片
    const files = await fs.readdir(chunksDir);
    const uploadedChunks = [];

    for (const file of files) {
      if (file.startsWith(fileId + '-')) {
        const chunkIndex = parseInt(file.split('-')[1]);
        if (!isNaN(chunkIndex)) {
          uploadedChunks.push(chunkIndex);
        }
      }
    }

    res.json({ uploadedChunks, completed: false });
  } catch (error) {
    res.status(500).json({ error: '获取上传状态失败' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});