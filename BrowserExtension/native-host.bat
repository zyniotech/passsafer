@echo off
:: Runs the Node.js script as Native Messaging Host
node "%~dp0native-host.js" %* 2> "%~dp0error.log"
