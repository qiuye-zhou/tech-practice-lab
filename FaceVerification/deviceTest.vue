<template>
  <div class="page page-wrapped flex flex-col">
    <div v-show="isLoading" class="loading"></div>

    <div v-show="!isLoading" class="face-verification">
      <div class="verification-wrap">
        <div class="center">
          <div class="centerLR">
            <div class="verification-content">
              <!-- <h2>人脸验证</h2> -->
              <p class="status-message">{{ statusMessage }}</p>

              <div class="camera-container">
                <video ref="videoElement" autoplay width="1000" height="600" :audio="false"></video>
                <canvas ref="canvasElement" style="display: none"></canvas>
                <div
                  v-if="faceDetected"
                  :class="[
                    'face-overlay',
                    { 'face-verifying': isVerifying, 'face-success': verificationSuccess }
                  ]"
                ></div>
              </div>

              <div v-if="errorMessage" class="error-message">
                {{ errorMessage }}
              </div>

              <div v-if="verificationSuccess" class="success-message">认证成功！</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>

import { Video } from 'api/auth/index'

export default {
  name: 'FaceVerification',
  data() {
    return {
      isLoading: false,
      statusMessage: '正在初始化摄像头...',
      errorMessage: '',
      faceDetected: false,
      videoStream: null,
      detectionInterval: null,
      unionId: localStorage.getItem('email') || '',
      isVerifying: false, // 是否正在验证中
      verificationSuccess: false, // 验证是否成功
      lastVerifyTime: 0, // 上次验证时间戳，用于防抖
      verifyInterval: 2000, // 验证间隔时间（毫秒），避免过于频繁请求
      isComponentActive: true
    }
  },
  created() {
    this.isLoading = true
    this.initCamera()
  },
  beforeUnmount() {
    console.log('组件即将卸载，清理所有资源...')
    this.isComponentActive = false // 标记组件为非活跃
    this.cleanup()
    this.clearCanvas()
  },
  methods: {
    async initCamera() {
      this.isComponentActive = true
      try {
        // 如果已经有视频流，先清理掉
        if (this.videoStream) {
          this.cleanup()
          // 等待一小段时间确保资源释放
          await new Promise((resolve) => setTimeout(resolve, 300))
        }

        // 获取用户媒体设备（摄像头）
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user' // 使用前置摄像头
          },
          audio: false
        })

        this.videoStream = stream
        this.$refs.videoElement.srcObject = stream
        this.isLoading = false
        this.statusMessage = '请正对摄像头'

        // 开始人脸检测
        this.startFaceDetection()
      } catch (error) {
        console.error('无法访问摄像头:', error)
        this.errorMessage = '无法访问摄像头，请检查权限设置'
        this.statusMessage = ''
        this.isLoading = false

        // 根据错误类型提供更具体的提示
        if (error.name === 'NotAllowedError') {
          alert('摄像头访问被拒绝，请在浏览器设置中允许摄像头权限后重试！')
        } else if (error.name === 'NotFoundError') {
          alert('未检测到摄像头设备，请检查设备连接！')
        } else {
          alert('摄像头初始化失败，请重试！')
        }
      }
    },

    // 重新获取人脸验证功能
    // 重新获取人脸验证功能
    retryCapture() {
      console.log('重新开始人脸验证...')

      // 重置状态
      this.verificationSuccess = false
      this.isVerifying = false
      this.faceDetected = false
      this.errorMessage = ''
      this.statusMessage = '正在重新初始化摄像头...'

      // 清理现有资源
      this.cleanup()
      this.clearCanvas()

      // 重新初始化摄像头
      this.initCamera()
    },

    cleanup() {
      console.log('清理摄像头和定时器资源...')

      // 标记组件为非活跃
      this.isComponentActive = false

      // 停止视频流
      if (this.videoStream) {
        this.videoStream.getTracks().forEach((track) => track.stop())
        this.videoStream = null
      }

      // 清除人脸检测定时器
      if (this.detectionInterval) {
        clearInterval(this.detectionInterval)
        this.detectionInterval = null
      }

      // 重置状态
      this.isVerifying = false
      this.verificationSuccess = false
      this.faceDetected = false
    },

    startFaceDetection() {
      // 增加检测频率，改为500ms检测一次
      this.detectionInterval = setInterval(() => {
        this.detectFace()
      }, 500)
    },

    detectFace() {
      // 如果组件不活跃，停止检测
      if (!this.isComponentActive) {
        return
      }
      // 如果验证成功，停止检测
      if (this.verificationSuccess) {
        return
      }

      const video = this.$refs.videoElement
      const canvas = this.$refs.canvasElement
      const context = canvas.getContext('2d')

      // 检查视频是否已准备好
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
        return
      }

      // 设置canvas尺寸与视频一致
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight

      // 绘制当前视频帧到canvas
      context.drawImage(video, 0, 0, canvas.width, canvas.height)

      // 这里应该使用人脸检测算法
      // 简单模拟人脸检测 - 实际项目中应使用专业库或API
      const hasFace = this.simulateFaceDetection(canvas)

      if (hasFace) {
        this.faceDetected = true
        this.statusMessage = '检测到人脸，正在验证...'

        // 实时进行人脸认证（带防抖机制）
        this.realTimeVerify()
      } else {
        this.faceDetected = false
        this.statusMessage = '请正对摄像头'
        this.errorMessage = ''
      }
    },

    simulateFaceDetection(canvas) {
      return true
    },

    // 实时验证（带防抖机制）
    realTimeVerify() {
      // 如果组件不活跃，停止验证
      if (!this.isComponentActive) {
        return
      }
      // 如果正在验证中，跳过
      if (this.isVerifying) {
        return
      }

      // 如果验证成功，不再验证
      if (this.verificationSuccess) {
        return
      }

      // 防抖：检查距离上次验证的时间间隔
      const now = Date.now()
      if (now - this.lastVerifyTime < this.verifyInterval) {
        return
      }

      // 更新上次验证时间
      this.lastVerifyTime = now

      // 执行验证
      this.submitVerification()
    },

    async submitVerification() {
      // 如果验证成功，不再验证
      if (this.verificationSuccess) {
        return
      }

      // 标记正在验证中
      this.isVerifying = true
      this.statusMessage = '正在验证人脸...'
      this.errorMessage = ''

      try {
        // 从当前视频帧获取图像
        const video = this.$refs.videoElement
        const canvas = this.$refs.canvasElement
        const context = canvas.getContext('2d')

        // 检查视频是否已准备好
        if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
          this.isVerifying = false
          return
        }

        // 设置canvas尺寸与视频一致
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight

        // 绘制当前视频帧到canvas
        context.drawImage(video, 0, 0, canvas.width, canvas.height)

        // 获取Base64格式的图片数据
        const imageDataUrl = canvas.toDataURL('image/jpeg', 0.8)
        const base64Data = imageDataUrl.split(',')[1]

        console.log('实时验证中...', 'base64Data length:', base64Data.length)

        const data = {
          imageType: 'BASE64',
          faceImage: base64Data,
          // schoolId: '6907716380389756928' //海实
          schoolId: '6907716361934819328', // 外中
          matchThreshold: 70
        }

        const response = await Video(data)
        console.log(response, '验证响应')

        if (response.data?.studentList && response.data.studentList.length > 0) {
          const studentId = response.data.studentList[0].studentId
          console.log('获取到的studentId:', studentId)

          // 验证成功
          this.verificationSuccess = true
          this.statusMessage = '验证成功！'
          this.errorMessage = ''

          localStorage.setItem('renlianId', studentId)
          localStorage.setItem('chuankou', 1)
          this.$emit('connection-change', studentId)

          // 验证成功后清除所有定时器
          this.cleanup()
        } else {
          // 验证失败，继续检测
          this.statusMessage = '未找到匹配的学生信息，请继续验证...'
          this.errorMessage = ''
          // this.$emit('connection-change', 1)
          localStorage.setItem('chuankou', 1)
          localStorage.setItem('renlianId', '')
        }
      } catch (error) {
        console.error('人脸验证失败:', error)
        this.statusMessage = '验证失败，请重试...'
        this.errorMessage = '人脸验证服务暂时不可用，请稍后再试'
      } finally {
        this.isVerifying = false
      }
    },

    // 清除canvas内容
    clearCanvas() {
      const canvas = this.$refs.canvasElement
      if (canvas) {
        const context = canvas.getContext('2d')
        // 清除画布内容
        context.clearRect(0, 0, canvas.width, canvas.height)
        // 重置画布尺寸为0
        canvas.width = 0
        canvas.height = 0
      }
    }
  }
}
</script>

<style scoped>
.page-wrapped {
  min-height: 100vh;
  /* background-color: #f5f5f5; */
}

.face-verification {
  width: 100%;
  max-width: 800px;
  margin: 0 auto;
}

.verification-content {
  border-radius: 8px;
  padding: 5px;
  /* box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1); */
  text-align: center;
}

.verification-content h2 {
  color: #333;
}

.status-message {
  font-size: 16px;
  color: #666;
  margin: 5px 0 5px;
  height: 20px;
}

.camera-container {
  position: relative;
  width: 40%;
  max-width: 400px;
  height: 30vw;
  margin: 0 auto;
  border-radius: 8px;
  overflow: hidden;
  background-color: #000;
}

video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.face-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 4px solid rgba(0, 255, 0, 0.5);
  border-radius: 8px;
  box-sizing: border-box;
  pointer-events: none;
  transition: border-color 0.3s ease;
}

.face-overlay.face-verifying {
  border-color: rgba(255, 193, 7, 0.8);
  animation: pulse-verifying 1.5s ease-in-out infinite;
}

.face-overlay.face-success {
  border-color: rgba(76, 175, 80, 0.8);
  animation: pulse-success 1s ease-in-out;
}

@keyframes pulse-verifying {
  0%,
  100% {
    border-color: rgba(255, 193, 7, 0.8);
    box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.7);
  }
  50% {
    border-color: rgba(255, 193, 7, 1);
    box-shadow: 0 0 0 10px rgba(255, 193, 7, 0);
  }
}

@keyframes pulse-success {
  0% {
    border-color: rgba(76, 175, 80, 0.8);
    box-shadow: 0 0 0 0 rgba(76, 175, 80, 0.7);
  }
  100% {
    border-color: rgba(76, 175, 80, 1);
    box-shadow: 0 0 0 15px rgba(76, 175, 80, 0);
  }
}

.error-message {
  color: #f44336;
  margin-top: 20px;
  font-size: 16px;
}

.success-message {
  color: #4caf50;
  margin-top: 20px;
  font-size: 18px;
  font-weight: bold;
  animation: fadeIn 0.5s ease-in;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(255, 255, 255, 0.8);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.loading::after {
  content: '';
  width: 50px;
  height: 50px;
  border: 5px solid #f3f3f3;
  border-top: 5px solid #3498db;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% {
    transform: rotate(0deg);
  }

  100% {
    transform: rotate(360deg);
  }
}
</style>
