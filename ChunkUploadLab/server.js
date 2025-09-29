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
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    cb(null, `${timestamp}-${random}`);
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

    // 检查源文件是否存在并重命名
    try {
      await fs.access(oldPath);
      await fs.rename(oldPath, newPath);
      console.log(`Renamed chunk file from ${oldPath} to ${newPath}`);
    } catch (error) {
      console.error(`File rename error: ${error.message}`);
      if (error.code === 'ENOENT') {
        console.log(`Source file not found: ${oldPath}, using original path`);
        // 如果源文件不存在，直接使用原路径
      } else {
        throw error;
      }
    }

    console.log(`Successfully uploaded chunk ${parseInt(chunkIndex) + 1}/${totalChunks} for file ${fileId}`);

    // 返回上传成功的响应
    res.json({
      success: true,
      chunkIndex: parseInt(chunkIndex),
      totalChunks: parseInt(totalChunks),
      fileId: fileId
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: '上传分片失败', details: error.message });
  }
});

// 合并分片接口
app.post('/merge', express.json(), async (req, res) => {
  try {
    const { fileId, fileName, fileHash } = req.body;
    if (!fileHash) {
      return res.status(400).json({ error: '缺少 fileHash 参数' });
    }

    console.log(`Starting merge for file ${fileName} with ID ${fileId}`);

    const chunksDir = path.join(__dirname, 'uploads', 'chunks');
    const targetPath = path.join(__dirname, 'uploads', fileName);

    // 确保目标目录存在
    await ensureUploadDirs();

    const files = await fs.readdir(chunksDir);
    console.log(`Found ${files.length} files in chunks directory`);

    const chunkFiles = files
      .filter(file => file.startsWith(fileId + '-'))
      .map(file => {
        // 使用 lastIndexOf 来找到最后一个 '-' 的位置，因为 fileId 本身包含 '-'
        const lastDashIndex = file.lastIndexOf('-');
        const chunkIndex = parseInt(file.substring(lastDashIndex + 1));
        return { index: chunkIndex, name: file };
      })
      .filter(chunk => !isNaN(chunk.index))
      .sort((a, b) => a.index - b.index);

    console.log(`Found ${chunkFiles.length} chunk files for file ${fileId}`);

    if (chunkFiles.length === 0) {
      return res.status(400).json({ error: '没有找到分片文件' });
    }

    // 创建写入流，用于合并文件
    const writeStream = require('fs').createWriteStream(targetPath);

    // 按顺序合并分片
    for (const chunkFile of chunkFiles) {
      const chunkPath = path.join(chunksDir, chunkFile.name);
      try {
        console.log(`Reading chunk ${chunkFile.name} (index: ${chunkFile.index})`);
        const chunkData = await fs.readFile(chunkPath);
        writeStream.write(chunkData);
      } catch (error) {
        console.error(`Error reading chunk ${chunkFile.name}: ${error.message}`);
        writeStream.destroy();
        throw new Error(`无法读取分片文件: ${chunkFile.name}`);
      }
    }

    writeStream.end();

    // 等待写入完成
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    console.log(`File ${fileName} written successfully`);

    // 合并完成后删除分片文件
    for (const chunkFile of chunkFiles) {
      try {
        await fs.unlink(path.join(chunksDir, chunkFile.name));
        console.log(`Deleted chunk file: ${chunkFile.name}`);
      } catch (error) {
        console.error(`Error deleting chunk ${chunkFile.name}: ${error.message}`);
        // 继续删除其他文件，不中断流程
      }
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
    res.status(500).json({ error: '合并文件失败', details: error.message });
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
        // 使用 lastIndexOf 来找到最后一个 '-' 的位置，因为 fileId 本身包含 '-'
        const lastDashIndex = file.lastIndexOf('-');
        const chunkIndex = parseInt(file.substring(lastDashIndex + 1));
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