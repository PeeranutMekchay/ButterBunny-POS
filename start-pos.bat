@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo ไม่พบ Node.js กรุณาติดตั้ง Node.js เวอร์ชัน LTS จาก https://nodejs.org ก่อน แล้วเปิดไฟล์นี้อีกครั้ง
  pause
  exit /b 1
)
if not exist node_modules (
  echo กำลังติดตั้งส่วนประกอบครั้งแรก...
  call npm install
  if errorlevel 1 (
    echo ติดตั้งไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ตแล้วลองอีกครั้ง
    pause
    exit /b 1
  )
)
start "" http://localhost:3000
call npm start
pause
