@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem สร้างทางลัดในโฟลเดอร์ Startup ให้ POS เปิดเองทุกครั้งที่เปิดเครื่องและล็อกอิน Windows
powershell -NoProfile -ExecutionPolicy Bypass -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\Butter Bunny POS.lnk'); $s.TargetPath='%~dp0start-pos.bat'; $s.WorkingDirectory='%~dp0'; $s.WindowStyle=7; $s.Description='Butter Bunny POS'; $s.Save()"
if errorlevel 1 (
  echo ตั้งค่าไม่สำเร็จ
  pause
  exit /b 1
)
echo.
echo เรียบร้อย! ต่อไปเปิดเครื่องแล้ว POS จะเปิดเองอัตโนมัติ (หน้าต่างดำจะย่ออยู่ที่แถบงาน ห้ามปิด)
echo ถ้าจะยกเลิก ให้เปิดไฟล์ uninstall-autostart.bat
pause
