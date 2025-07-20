// 全局变量，用于跟踪扫描器状态
var scannerActive = false;
var barcodeDetectorSupported = false;
var barcodeDetector = null;
var videoStream = null;
var videoElement = null;
var canvasElement = null;
var canvasContext = null;
var scannerAnimationFrame = null;

// 扫描相关函数声明 - 移到前面以确保定义在调用之前
function stopScanner(){
    scannerActive = false;
    
    // 清除对焦辅助定时器
    if (window.focusAssistInterval) {
        clearInterval(window.focusAssistInterval);
        window.focusAssistInterval = null;
    }
    
    // 停止动画帧
    if (scannerAnimationFrame) {
        cancelAnimationFrame(scannerAnimationFrame);
        scannerAnimationFrame = null;
    }
    
    // 停止视频流
    if (videoStream) {
        videoStream.getTracks().forEach(track => track.stop());
        videoStream = null;
    }
    
    // 清理视频元素
    if (videoElement) {
        videoElement.srcObject = null;
        videoElement = null;
    }
    
    // 如果仍在使用 html5QrCode
    if(html5QrCode){
        // 使用Promise处理停止过程
        return new Promise((resolve) => {
            html5QrCode.stop().then(() => {
                html5QrCode.clear();
                html5QrCode = null;
                console.log("扫描器已完全停止");
                resolve();
            }).catch(err => {
                console.log("停止扫描器失败:", err);
                html5QrCode = null;
                resolve();
            });
        });
    } else {
        return Promise.resolve();
    }
}

function closeScannerModal(){
    $("#scannerModal").modal('hide');
    $("#scannerModal").removeClass('show').css('display', 'none');
    stopScanner();
    $("#quantityModal").addClass("d-none");
}

$(document).ready(function(){
    window.orderTable = $('#orderTable').DataTable({paging: false,
      searching: false,
      info: false,
      ordering: false,
      scrollX: true,
      autoWidth: false,
      createdRow: function(row, data, dataIndex) {
          $('td', row).attr('contenteditable', true);
      },
      data: []
    });

    // 初始调整列宽，防止表头与数据错位
    orderTable.columns.adjust();

    // 同步用户编辑的内容
    $('#orderTable').on('blur', 'td[contenteditable="true"]', function() {
      var cell = orderTable.cell(this);
      var newValue = $(this).text().trim();
      cell.data(newValue).draw(false);
    });

    // 复制
    $("#copyBtn").on("click", function(){
      var colCount = orderTable.columns().count();
      var clipboardContent = "";

      // 表头
      orderTable.columns().every(function(colIdx){
          var headerText = $(orderTable.column(colIdx).header()).text().trim();
          clipboardContent += headerText + (colIdx < colCount - 1 ? "\t" : "\n");
      });

      // 表体
      orderTable.rows().every(function(){
          var rowData = this.data();
          for(var i=0; i<rowData.length; i++){
              clipboardContent += (rowData[i] || "");
              clipboardContent += (i < rowData.length - 1 ? "\t" : "\n");
          }
      });

      // 复制到剪贴板
      var tempElement = $("<textarea>");
      tempElement.val(clipboardContent);
      $("body").append(tempElement);
      tempElement.select();
      document.execCommand("copy");
      tempElement.remove();

      showToast("复制成功");
    });

    // 导出
    $("#exportBtn").on("click", function(){
      var colCount = orderTable.columns().count();
      var exportData = [];

      // 表头
      var headerRow = [];
      orderTable.columns().every(function(colIdx){
          var headerText = $(orderTable.column(colIdx).header()).text().trim();
          headerRow.push(headerText);
      });
      exportData.push(headerRow);

      // 表体
      orderTable.rows().every(function(){
          var rowData = this.data();
          var rowArr = [];
          for(var i=0; i<rowData.length; i++){
              rowArr.push(rowData[i] || "");
          }
          exportData.push(rowArr);
      });

      var worksheet = XLSX.utils.aoa_to_sheet(exportData);
      var workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, "OrderList");
      XLSX.writeFile(workbook, "order_list.xlsx");
      showToast("导出成功");
    });

    // 打开、关闭扫描
    $("#scanBtn").on("click", openScannerModal);
    $("#closeScanner").on("click", closeScannerModal);

    // 数量相关
    var currentQty = 1;
    $("#increaseQty").on("click", function(){
        currentQty++;
        $("#currentQty").text(currentQty);
    });
    $("#decreaseQty").on("click", function(){
        if(currentQty > 1) {
            currentQty--;
            $("#currentQty").text(currentQty);
        }
    });
    // 确定添加
    $("#confirmQty").on("click", function(){
        var code = $("#scannedCode").text().trim();
        var found = false;
        orderTable.rows().every(function(){
            var data = this.data();
            if(data[0] === code){
                var currentOrder = parseInt(data[1]) || 0;
                var newOrder = currentOrder + currentQty;
                data[1] = newOrder.toString();
                this.data(data);
                found = true;
                return false;
            }
        });
        if(!found){
            orderTable.row.add([code, currentQty.toString()]).draw(false);
        }
        // 再次调整列宽，保持对齐
        orderTable.columns.adjust();
        showToast("添加成功");
        
        // 隐藏数量调整，重置
        $("#quantityModal").addClass("d-none");
        currentQty = 1;
        $("#currentQty").text(currentQty);
        
        // 安全地重启扫描器
        restartScanner();
    });
    // 取消添加
    $("#cancelQty").on("click", function(){
        $("#quantityModal").addClass("d-none");
        currentQty = 1;
        $("#currentQty").text(currentQty);
        
        // 安全地重启扫描器
        restartScanner();
    });

    // 安全重启扫描器的函数
    function restartScanner() {
        stopScanner().then(() => {
            // 短暂延迟后启动，确保资源完全释放
            setTimeout(() => {
                startScanner();
            }, 500);
        });
    }

    // 刷新关闭提示
    window.onbeforeunload = function(e) {
        return "确定要刷新或关闭吗？未保存的数据可能会丢失。";
    };

    // modal事件
    $('#scannerModal').on('shown.bs.modal', function () {
        startScanner();
    });
    $('#scannerModal').on('hidden.bs.modal', function () {
        stopScanner();
    });

    // 阻止双击放大
    document.addEventListener('dblclick', function(e){
        e.preventDefault();
    }, { passive: false });

    // 添加手动添加按钮的功能
    $("#addManualBtn").on("click", function(){
        // 添加一个空行
        orderTable.row.add(["", ""]).draw(false);
        // 聚焦到新添加的行的第一个单元格
        setTimeout(function() {
            $('tr:last-child td:first-child', orderTable.table().body()).focus();
        }, 100);
        // 再次调整列宽，保持对齐
        orderTable.columns.adjust();
    });
});

function openScannerModal(){
    $("#scannerModal").modal('show');
    $("#scannerModal").addClass('show').css('display', 'block');
    
    // 显示加载指示器
    $("#loadingIndicator").removeClass("d-none");
    $("#loadingIndicator").html(`
        <div class="spinner-border text-light" role="status">
            <span class="visually-hidden">加载中...</span>
        </div>
        <p>正在启动摄像头...</p>
    `);
    
    // 检查是否支持 BarcodeDetector API
    checkBarcodeDetectorSupport();
}

// 检查浏览器是否支持 BarcodeDetector API
function checkBarcodeDetectorSupport() {
    if ('BarcodeDetector' in window) {
        BarcodeDetector.getSupportedFormats()
            .then(supportedFormats => {
                console.log('支持的条码格式:', supportedFormats);
                barcodeDetectorSupported = true;
                
                // 创建 BarcodeDetector 实例
                barcodeDetector = new BarcodeDetector({
                    formats: [
                        'ean_13', 'ean_8', 'code_128', 'code_39', 
                        'code_93', 'codabar', 'upc_a', 'upc_e', 'itf'
                    ]
                });
            })
            .catch(err => {
                console.log('获取支持的条码格式失败:', err);
                barcodeDetectorSupported = false;
            });
    } else {
        console.log('浏览器不支持 BarcodeDetector API');
        barcodeDetectorSupported = false;
    }
}

// 扫描相关
var html5QrCode = null;
function startScanner(){
    // 防止多次启动
    if(scannerActive) {
        console.log("扫描器已在运行中");
        return;
    }
    
    scannerActive = true;
    
    // 如果支持 BarcodeDetector API，使用原生 API
    if (barcodeDetectorSupported) {
        startNativeScanner();
    } else {
        // 否则使用 HTML5QrCode
        // 确保先清除旧实例
        if(html5QrCode){
            html5QrCode.stop().then(() => {
                html5QrCode.clear();
                html5QrCode = null;
                initNewScanner();
            }).catch(() => {
                html5QrCode = null;
                initNewScanner();
            });
        } else {
            initNewScanner();
        }
    }
}

// 使用原生 BarcodeDetector API 的扫描器
function startNativeScanner() {
    // 清除扫描容器
    $("#interactive").empty();
    
    // 创建视频元素
    videoElement = document.createElement('video');
    videoElement.setAttribute('playsinline', 'true');
    videoElement.setAttribute('autoplay', 'true');
    videoElement.style.width = '100%';
    videoElement.style.height = '100%';
    videoElement.style.objectFit = 'cover';
    
    // 创建 canvas 元素用于处理视频帧
    canvasElement = document.createElement('canvas');
    canvasElement.style.display = 'none';
    
    // 创建扫描框和动画元素
    const scannerBox = document.createElement('div');
    scannerBox.className = 'scanner-box';
    
    // 添加扫描线
    const scanLine = document.createElement('div');
    scanLine.className = 'scan-line';
    scannerBox.appendChild(scanLine);
    
    // 添加四个角
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    corners.forEach(corner => {
        const cornerElement = document.createElement('div');
        cornerElement.className = `corner ${corner}`;
        scannerBox.appendChild(cornerElement);
    });
    
    // 将元素添加到容器
    document.getElementById('interactive').appendChild(videoElement);
    document.getElementById('interactive').appendChild(canvasElement);
    document.getElementById('interactive').appendChild(scannerBox);
    
    // 获取视频流
    const constraints = {
        audio: false,
        video: {
            facingMode: 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
        }
    };
    
    // 在 iOS 上添加特殊配置
    if (isIOS()) {
        constraints.video.zoom = 2.0; // 设置初始缩放
    }
    
    navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
            videoStream = stream;
            videoElement.srcObject = stream;
            enableTorchOnStream(stream); // 尝试开启闪光灯
            
            // 等待视频加载
            videoElement.onloadedmetadata = () => {
                videoElement.play();
                
                // 设置 canvas 尺寸
                canvasElement.width = videoElement.videoWidth;
                canvasElement.height = videoElement.videoHeight;
                canvasContext = canvasElement.getContext('2d', { willReadFrequently: true });
                
                // 隐藏加载指示器
                $("#loadingIndicator").addClass("d-none");
                
                // 开始扫描循环
                scanFrame();
                
                // 启用对焦辅助
                startFocusAssist();
                
                // 自适应调整扫描框大小
                adjustScannerBoxSize();
                
                console.log("原生扫描器启动成功");
            };
            
            // 为 iOS 设备优化相机设置
            if (isIOS()) {
                optimizeIOSCamera(stream);
            } else {
                // 若不是 iOS，也尝试直接启用 torch
                enableTorchOnStream(stream);
            }
        })
        .catch(err => {
            console.log("启动原生扫描器失败:", err);
            handleScannerError(err);
            scannerActive = false;
        });
}

// 检测是否为 iOS 设备
function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
}

// 为 iOS 设备优化相机设置
function optimizeIOSCamera(stream) {
    const videoTrack = stream.getVideoTracks()[0];
    
    if (videoTrack) {
        // 尝试启用低光增强
        if (videoTrack.getCapabilities && videoTrack.getCapabilities().torch) {
            // 检查是否在低光环境
            const imageCapture = new ImageCapture(videoTrack);
            imageCapture.getPhotoCapabilities()
                .then(capabilities => {
                    // 如果支持低光模式，尝试启用
                    if (capabilities.redEyeReduction) {
                        videoTrack.applyConstraints({
                            advanced: [{ torch: true }]
                        }).catch(e => console.log("无法启用低光增强:", e));
                    }
                })
                .catch(e => console.log("获取相机能力失败:", e));
        }
        
        // 设置连续自动对焦
        videoTrack.applyConstraints({
            advanced: [
                { focusMode: "continuous" },
                { exposureMode: "continuous" },
                { whiteBalanceMode: "continuous" }
            ]
        }).catch(e => console.log("设置连续自动对焦失败:", e));
    }
}

// 扫描视频帧
function scanFrame() {
    if (!scannerActive || !videoElement || !canvasElement || !canvasContext || !barcodeDetector) {
        return;
    }
    
    // 检查视频是否准备好
    if (videoElement.readyState === videoElement.HAVE_ENOUGH_DATA) {
        // 在 canvas 上绘制当前视频帧
        canvasContext.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);
        
        // 使用 BarcodeDetector 检测条码
        barcodeDetector.detect(canvasElement)
            .then(barcodes => {
                if (barcodes.length > 0) {
                    // 找到条码
                    const barcode = barcodes[0];
                    console.log("检测到条码:", barcode.rawValue);
                    
                    // 处理扫描结果
                    onScanSuccess(barcode.rawValue, barcode);
                }
            })
            .catch(err => {
                console.log("条码检测失败:", err);
            });
    }
    
    // 继续下一帧
    scannerAnimationFrame = requestAnimationFrame(scanFrame);
}

// 初始化 HTML5QrCode 扫描器（作为备用）
function initNewScanner() {
    // 清除扫描容器
    $("#interactive").empty();
    
    // 创建扫描框和动画元素
    const scannerBox = document.createElement('div');
    scannerBox.className = 'scanner-box';
    
    // 添加扫描线
    const scanLine = document.createElement('div');
    scanLine.className = 'scan-line';
    scannerBox.appendChild(scanLine);
    
    // 添加四个角
    const corners = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
    corners.forEach(corner => {
        const cornerElement = document.createElement('div');
        cornerElement.className = `corner ${corner}`;
        scannerBox.appendChild(cornerElement);
    });
    
    // 将扫描框添加到容器
    document.getElementById('interactive').appendChild(scannerBox);
    
    // 获取最佳配置
    const config = getOptimalScanConfig();
    
    // 创建新实例
    html5QrCode = new Html5Qrcode("interactive");
    
    // 尝试启动
    function attemptStart(retries = 3) {
        html5QrCode.start(
            { facingMode: "environment" },
            config,
            onScanSuccess,
            onScanFailure
        ).then(() => {
            $("#loadingIndicator").addClass("d-none");
            startFocusAssist();
            
            // 自适应调整扫描框大小
            adjustScannerBoxSize();
            
            console.log("扫描器启动成功");
            // 尝试开启闪光灯 (若支持)
            if (html5QrCode && html5QrCode.applyVideoConstraints) {
                html5QrCode.applyVideoConstraints({ advanced: [{ torch: true }] }).catch(() => {});
            }
            
            // 立即尝试对焦，提高初始识别速度
            setTimeout(() => {
                forceFocus();
            }, 500);
            
        }).catch(err => {
            console.log(`启动扫描器失败 (尝试 ${4-retries}/3):`, err);
            if (retries > 1) {
                setTimeout(() => attemptStart(retries - 1), 1000);
            } else {
                handleScannerError(err);
                scannerActive = false;
            }
        });
    }
    
    attemptStart();
}

// 新增：强制对焦函数
function forceFocus() {
    try {
        const videoElement = document.querySelector('#interactive video');
        if (videoElement && videoElement.srcObject) {
            const tracks = videoElement.srcObject.getVideoTracks();
            if (tracks.length > 0) {
                const track = tracks[0];
                
                // 尝试设置手动对焦模式
                track.applyConstraints({
                    advanced: [
                        { focusMode: "continuous" },
                        { exposureMode: "continuous" },
                        { whiteBalanceMode: "continuous" }
                    ]
                }).catch(e => console.log("对焦设置失败:", e));
                
                // 尝试手动对焦
                if (track.getCapabilities && track.getCapabilities().focusDistance) {
                    track.applyConstraints({
                        advanced: [{ focusDistance: 0.5 }] // 中等距离对焦
                    }).catch(e => console.log("距离对焦失败:", e));
                }
            }
        }
    } catch (e) {
        console.log("强制对焦失败:", e);
    }
}

// 优化对焦辅助功能
function startFocusAssist() {
    // 每0.8秒尝试重新对焦一次
    const focusInterval = setInterval(() => {
        if (scannerActive) {
            if (barcodeDetectorSupported && videoStream) {
                // 为原生扫描器优化对焦
                optimizeFocus();
            } else if (html5QrCode && html5QrCode._isScanning) {
                // 为 HTML5QrCode 优化对焦
                forceFocus();
            }
        } else {
            // 如果扫描停止，清除定时器
            clearInterval(focusInterval);
        }
    }, 800);
    
    // 存储定时器ID以便清理
    window.focusAssistInterval = focusInterval;
}

// 为原生扫描器优化对焦
function optimizeFocus() {
    if (!videoStream) return;
    
    try {
        const videoTrack = videoStream.getVideoTracks()[0];
        if (videoTrack) {
            // 尝试设置手动对焦模式
            videoTrack.applyConstraints({
                advanced: [
                    { focusMode: "continuous" },
                    { exposureMode: "continuous" }
                ]
            }).catch(e => console.log("对焦设置失败:", e));
            
            // 在 iOS 上尝试特殊优化
            if (isIOS()) {
                // 尝试调整缩放以帮助对焦
                if (videoTrack.getCapabilities && videoTrack.getCapabilities().zoom) {
                    const zoomCap = videoTrack.getCapabilities().zoom;
                    // 轻微调整缩放以触发重新对焦
                    videoTrack.applyConstraints({
                        advanced: [{ zoom: Math.min(zoomCap.max, 2.0) }]
                    }).catch(e => console.log("缩放调整失败:", e));
                }
            }
        }
    } catch (e) {
        console.log("优化对焦失败:", e);
    }
}

// 修改扫描成功的处理函数，提高精确性
function onScanSuccess(decodedText, decodedResult) {
    // 防止重复扫描同一条码
    var now = Date.now();
    if(decodedText === lastCode && now - lastTime < 500) { 
        return;
    }
    
    // 播放音效
    playSuccessAudio();
    
    // 额外的验证检查，提高可靠性
    if (validateBarcode(decodedText)) {
        onBarcodeDetected(decodedText);
    }
}

// 优化条码验证功能
function validateBarcode(code) {
    // 基本验证：不为空且长度合理
    if (!code || code.length < 3 || code.length > 30) return false;
    
    // 条码通常是纯数字或有固定格式
    const isValidFormat = /^[A-Za-z0-9\-\.\/]+$/.test(code);
    
    // 增加额外验证，尝试消除噪音
    if (code.includes(" ") || code.includes("\n") || code.includes("\t")) {
        code = code.replace(/[\s\r\n]+/g, '');
    }
    
    return isValidFormat;
}

function onScanFailure(error) {
    // 扫描失败会频繁回调，不做处理
}
function handleScannerError(err){
    console.log("扫描器错误:", err);
    $("#scanner-container").html(`
        <div class="scanner-error">
            <i class="fas fa-exclamation-triangle"></i>
            <p>无法访问摄像头</p>
            <ul class="text-start">
                <li>您已授予摄像头访问权限</li>
                <li>您使用的是HTTPS连接</li>
                <li>您的设备有可用的摄像头</li>
            </ul>
            <button class="btn btn-primary mt-3" onclick="requestCameraPermission()">重试访问摄像头</button>
        </div>
    `);
}

function requestCameraPermission(){
    navigator.mediaDevices.getUserMedia({ video: true })
        .then(stream => {
            stream.getTracks().forEach(track => track.stop());
            startScanner();
        })
        .catch(err => {
            console.log("获取摄像头权限失败:", err);
            handleScannerError(err);
        });
}

// 避免重复扫码
var lastCode = "";
var lastTime = 0;
var scanningFlag = false;
function onBarcodeDetected(decodedText){
    if(scanningFlag) return;
    var now = Date.now();
    
    // 提高检测间隔，增强稳定性
    if(decodedText === lastCode && now - lastTime < 1000) {
        return;
    }
    
    scanningFlag = true;
    lastCode = decodedText;
    lastTime = now;
    
    // 先暂停扫描
    if(html5QrCode){
        html5QrCode.pause();
    }
    
    // 整理条码 - 去除空格和特殊字符
    decodedText = decodedText.trim().replace(/[\s\r\n]+/g, '');
    
    // 显示到 quantityModal
    $("#scannedCode").text(decodedText);
    $("#quantityModal").removeClass("d-none");
    $("#currentQty").text("1");
    
    // 重置当前数量
    currentQty = 1;
    
    // 1秒后才允许再次触发
    setTimeout(() => { scanningFlag = false; }, 1000);
}

// 修改播放音效函数，禁用声音
function playSuccessAudio(){
    // 振动反馈
    if (navigator.vibrate) {
        navigator.vibrate(50);
    }
    
    // 扫描区域闪烁效果
    $('.scanner-box').addClass('success');
    setTimeout(function() {
        $('.scanner-box').removeClass('success');
    }, 300);
}

// 显示Toast
function showToast(msg){
    $("#toastMessage").html('<i class="fas fa-check-circle"></i> ' + msg).removeClass("d-none");
    setTimeout(() => {
        $("#toastMessage").addClass("d-none");
    }, 1500);
}

// 全局扫描配置优化
function getOptimalScanConfig() {
    return {
        fps: 30,
        qrbox: {
            width: 250,        
            height: 100,
        },
        aspectRatio: 1.0,
        disableFlip: false,
        formatsToSupport: [
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.CODE_39,
            Html5QrcodeSupportedFormats.UPC_A,
            Html5QrcodeSupportedFormats.UPC_E
        ],
        experimentalFeatures: {
            useBarCodeDetectorIfSupported: true
        },
        videoConstraints: {
            facingMode: "environment",
            width:  { ideal: 1280 },  
            height: { ideal: 720 },
            frameRate: { ideal: 30, max: 30 }
        }
    };
}

// 添加自适应调整扫描框大小的函数
function adjustScannerBoxSize() {
    const container = document.getElementById('interactive');
    const scannerBox = document.querySelector('.scanner-box');
    
    if (!container || !scannerBox) return;
    
    // 获取容器尺寸
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;
    
    // 计算扫描框尺寸 (宽度为容器宽度的70%，高度为宽度的40%)
    let boxWidth = Math.min(containerWidth * 0.7, 280);
    let boxHeight = boxWidth * 0.4;
    
    // 确保扫描框不会太大或太小
    boxWidth = Math.max(boxWidth, 200);
    boxHeight = Math.max(boxHeight, 80);
    
    // 应用尺寸
    scannerBox.style.width = `${boxWidth}px`;
    scannerBox.style.height = `${boxHeight}px`;
    
    // 在窗口大小变化时重新调整
    window.addEventListener('resize', adjustScannerBoxSize);
}

// 通用：尝试开启闪光灯（torch）
function enableTorchOnStream(stream) {
    try {
        const track = stream && stream.getVideoTracks()[0];
        if (track) {
            const caps = track.getCapabilities && track.getCapabilities();
            if (caps && caps.torch) {
                track.applyConstraints({ advanced: [{ torch: true }] }).catch(() => {});
            }
        }
    } catch (e) {
        console.log("启用闪光灯失败", e);
    }
}
