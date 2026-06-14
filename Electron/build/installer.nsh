!macro customInstall
  ; Generate de.passsafer.helper.json with absolute path to native-host.bat
  ; $INSTDIR is the installation directory (e.g. C:\Users\username\AppData\Local\Programs\passsafer-electron)
  FileOpen $0 "$INSTDIR\resources\native-host\de.passsafer.helper.json" w
  FileWrite $0 '{$\r$\n'
  FileWrite $0 '  "name": "de.passsafer.helper",$\r$\n'
  FileWrite $0 '  "description": "PassSafer Native Messaging Host",$\r$\n'
  FileWrite $0 '  "path": "$INSTDIR\resources\native-host\native-host.bat",$\r$\n'
  FileWrite $0 '  "type": "stdio",$\r$\n'
  FileWrite $0 '  "allowed_origins": [$\r$\n'
  FileWrite $0 '    "chrome-extension://iimaibjnobgoecdbaeojkaikbkfbdhme/",$\r$\n'
  FileWrite $0 '    "chrome-extension://pgccapkkkbbfeoafdmjibnjkiplnnffn/"$\r$\n'
  FileWrite $0 '  ]$\r$\n'
  FileWrite $0 '}$\r$\n'
  FileClose $0

  ; Registry-Einträge für Google Chrome, Brave und Microsoft Edge erstellen
  WriteRegStr HKCU "Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
  WriteRegStr HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
  WriteRegStr HKCU "Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper" "" "$INSTDIR\resources\native-host\de.passsafer.helper.json"
!macroend

!macro customUnInstall
  ; Registry-Einträge bei Deinstallation sauber entfernen
  DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\de.passsafer.helper"
  DeleteRegKey HKCU "Software\BraveSoftware\Brave\NativeMessagingHosts\de.passsafer.helper"
  DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\de.passsafer.helper"
!macroend
