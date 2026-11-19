@echo off
chcp 65001 >nul
title Butter Bunny POS
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
rem เปิดหน้าเว็บครั้งแรกครั้งเดียว ถ้าโปรแกรมหยุดเองจะเปิดใหม่ให้ภายใน 5 วินาที
set OPEN_BROWSER=1
:loop
node --disable-warning=ExperimentalWarning server\index.js
if "%errorlevel%"=="3" exit /b 0
set OPEN_BROWSER=0
echo.
echo โปรแกรมหยุดทำงาน จะเปิดใหม่ใน 5 วินาที (ปิดหน้าต่างนี้ถ้าต้องการหยุด)
timeout /t 5 /nobreak >nul
goto loop
