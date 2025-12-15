<template>
  <div class="voice-lab">
    <h2>语音合成实验</h2>

    <!-- 文本输入区域 -->
    <el-input type="textarea" v-model="inputText" placeholder="请输入要转换为语音的文本..." :rows="4" style="margin-bottom: 20px" />

    <!-- 语音控制面板 -->
    <div class="voice-controls">
      <!-- 语音选择器 -->
      <div v-if="availableVoices.length > 0" class="voice-selector">
        <div style="margin-bottom: 10px; font-weight: bold;">选择语音:</div>
        <el-select v-model="selectedVoiceIndex" placeholder="选择语音" style="width: 250px">
          <el-option v-for="(voice, index) in availableVoices" :key="index" :label="`${voice.name} (${voice.lang})`"
            :value="index" />
        </el-select>
      </div>

      <!-- 语速控制器 -->
      <div class="rate-control">
        <div style="margin-bottom: 10px; font-weight: bold;">语速调节:</div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span>慢</span>
          <el-slider v-model="speechRate" :min="0.5" :max="2" :step="0.1" style="width: 200px" />
          <span>快</span>
          <el-tag>{{ speechRate.toFixed(1) }}x</el-tag>
        </div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="action-buttons">
      <el-button type="primary" @click="speakText(inputText)" :disabled="!inputText || isSpeaking" size="large">
        {{ isSpeaking ? '🔊 播放中...' : '▶️ 开始朗读' }}
      </el-button>

      <el-button @click="stopSpeaking" :disabled="!isSpeaking" size="large">
        ⏹️ 停止朗读
      </el-button>

      <el-button @click="refreshVoices" type="info" size="large">
        🔄 刷新语音
      </el-button>
    </div>

    <!-- 状态提示 -->
    <div class="status" :class="statusType" v-if="statusMessage">
      {{ statusMessage }}
    </div>

    <!-- 语音列表 -->
    <div v-if="availableVoices.length > 0" style="margin-top: 20px;">
      <h3>可用语音 ({{ availableVoices.length }} 个)</h3>
      <el-table :data="availableVoices" style="width: 100%" size="small">
        <el-table-column prop="name" label="语音名称" width="200"></el-table-column>
        <el-table-column prop="lang" label="语言" width="120"></el-table-column>
        <el-table-column label="默认">
          <template #default="scope">
            <el-tag v-if="scope.$index === selectedVoiceIndex" type="success">当前选择</el-tag>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div v-else style="text-align: center; margin-top: 20px;">
      <el-alert title="正在加载语音列表，请稍候..." type="info" show-icon :closable="false" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount, computed, watch } from 'vue'

// 响应式数据
const inputText = ref('欢迎使用语音合成实验室！您可以在这里输入任何想要朗读的文字。')
const speechSynthesis = window.speechSynthesis
const availableVoices = ref([])
const selectedVoiceIndex = ref(null)
const speechRate = ref(1)
const currentSpeech = ref(null)
const statusMessage = ref('')
const statusType = ref('')

// 计算属性
const isSpeaking = computed(() => {
  return currentSpeech.value !== null
})

// 方法定义
const loadVoices = () => {
  availableVoices.value = speechSynthesis.getVoices()

  if (availableVoices.value.length > 0 && selectedVoiceIndex.value === null) {
    // 优先选择中文语音
    const chineseVoice = availableVoices.value.findIndex(
      voice => voice.lang.startsWith('zh')
    )

    if (chineseVoice !== -1) {
      selectedVoiceIndex.value = chineseVoice
      showStatus(`已自动选择中文语音: ${availableVoices.value[chineseVoice].name}`, 'success')
    } else {
      selectedVoiceIndex.value = 0
      showStatus(`已选择默认语音: ${availableVoices.value[0].name}`, 'success')
    }
  } else if (availableVoices.value.length === 0) {
    showStatus('当前浏览器未检测到可用语音，可能需要联网获取', 'warning')
  }
}

const showStatus = (message, type) => {
  statusMessage.value = message
  statusType.value = type
  setTimeout(() => {
    statusMessage.value = ''
  }, 3000)
}

const refreshVoices = () => {
  loadVoices()
  showStatus('语音列表已刷新', 'success')
}

const speakText = (text) => {
  // 停止当前播放
  if (currentSpeech.value) {
    speechSynthesis.cancel()
  }

  if (!text) {
    showStatus('请输入要朗读的文本', 'warning')
    return
  }

  // 检查是否选择了语音
  if (selectedVoiceIndex.value === null || availableVoices.value.length === 0) {
    showStatus('未选择语音或无可用语音', 'warning')
    return
  }

  // 创建语音实例
  currentSpeech.value = new SpeechSynthesisUtterance(text)
  currentSpeech.value.voice = availableVoices.value[selectedVoiceIndex.value]
  currentSpeech.value.rate = speechRate.value

  // 设置语音事件回调
  currentSpeech.value.onend = () => {
    currentSpeech.value = null
    showStatus('朗读完成', 'success')
  }

  currentSpeech.value.onerror = (event) => {
    currentSpeech.value = null
    showStatus(`朗读出错: ${event.error}`, 'warning')
  }

  // 开始播放
  speechSynthesis.speak(currentSpeech.value)
  showStatus('开始朗读...', 'success')
}

const stopSpeaking = () => {
  if (currentSpeech.value) {
    speechSynthesis.cancel()
    currentSpeech.value = null
    showStatus('已停止朗读', 'success')
  }
}

// 初始化语音功能
const initSpeech = () => {
  if ('speechSynthesis' in window) {
    // 等待语音数据加载完成
    speechSynthesis.onvoiceschanged = () => {
      loadVoices()
    }

    // 如果语音已经加载完成，直接加载
    if (speechSynthesis.getVoices().length > 0) {
      loadVoices()
    } else {
      // 延迟加载以确保获取到语音列表
      setTimeout(loadVoices, 1000)
    }
  } else {
    showStatus('当前浏览器不支持语音合成 API', 'warning')
  }
}

// 生命周期钩子
onMounted(() => {
  initSpeech()
})

onBeforeUnmount(() => {
  stopSpeaking()
})
</script>

<style scoped>
.voice-lab {
  background: white;
  padding: 30px;
  border-radius: 8px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.voice-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 30px;
  align-items: center;
  margin: 20px 0;
  padding: 15px;
  background-color: #f9f9f9;
  border-radius: 4px;
}

.action-buttons {
  display: flex;
  gap: 10px;
  margin-top: 20px;
  flex-wrap: wrap;
}

.status {
  margin-top: 15px;
  padding: 10px;
  border-radius: 4px;
  text-align: center;
}

.success {
  background-color: #f0f9ff;
  color: #0066cc;
}

.warning {
  background-color: #fff7e6;
  color: #fa8c16;
}

@media (max-width: 768px) {
  .voice-controls {
    flex-direction: column;
    align-items: stretch;
  }

  .action-buttons {
    flex-direction: column;
  }

  .action-buttons .el-button {
    width: 100%;
  }
}
</style>