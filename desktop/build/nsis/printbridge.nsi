; PrintBridge Desktop — instalador NSIS básico
; 1) pyinstaller --noconsole --onefile --icon resources/icon.ico ^
;       --add-data "resources;resources" printbridge/main.py
; 2) copiar el contenido de dist/ a build/nsis/dist_bin/ (o ajustar la ruta abajo)
; 3) makensis build/nsis/printbridge.nsi

!define APP_NAME "PrintBridge Desktop"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "PrintFlow ERP"
!define APP_EXE "printbridge.exe"
!define RUN_KEY "Software\Microsoft\Windows\CurrentVersion\Run"

Name "${APP_NAME} ${APP_VERSION}"
OutFile "PrintBridgeDesktop-${APP_VERSION}-setup.exe"
InstallDir "$PROGRAMFILES\${APP_NAME}"
InstallDirRegKey HKLM "Software\${APP_NAME}" "InstallDir"
RequestExecutionLevel admin
SetCompressor /SOLID lzma

Page Directory
Page InstFiles
UninstPage UninstConfirm
UninstPage InstFiles

Section "Instalar ${APP_NAME}"
  SetOutPath "$INSTDIR"
  File /r /x "*.db" /x "*.log" "dist_bin\*.*"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKLM "Software\${APP_NAME}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "Software\${APP_NAME}" "Version" "${APP_VERSION}"

  ; Inicio automático con el usuario actual
  WriteRegStr HKCU "${RUN_KEY}" "PrintBridgeDesktop" '"$INSTDIR\${APP_EXE}" --tray'

  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "--tray" "$INSTDIR\resources\icon.ico"
  CreateShortCut "$SMPROGRAMS\${APP_NAME}\Consola.lnk" "$INSTDIR\${APP_EXE}" "--console" "$INSTDIR\resources\icon.ico"
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "--tray" "$INSTDIR\resources\icon.ico"

  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}" "DisplayVersion" "${APP_VERSION}"
SectionEnd

Section "Desinstalar"
  Delete "$INSTDIR\uninstall.exe"
  RMDir /r "$INSTDIR"
  Delete "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk"
  Delete "$SMPROGRAMS\${APP_NAME}\Consola.lnk"
  RMDir "$SMPROGRAMS\${APP_NAME}"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegValue HKCU "${RUN_KEY}" "PrintBridgeDesktop"
  DeleteRegKey HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_NAME}"
  DeleteRegKey HKLM "Software\${APP_NAME}"
SectionEnd
