# Builds the Solaris Client mod with the installed JDK 25. Output: %LOCALAPPDATA%\solaris-client-build\libs\solaris-client-<version>.jar
$env:JAVA_HOME = 'C:\Program Files\Microsoft\jdk-25.0.5.21-hotspot'
Set-Location $PSScriptRoot
& .\gradlew.bat build --no-daemon --console=plain *>&1 | Tee-Object -FilePath build.log
Write-Host ''
Write-Host "Exit code: $LASTEXITCODE"
Get-ChildItem "$env:LOCALAPPDATA\solaris-client-build\libs" -ErrorAction SilentlyContinue | Select-Object Name, Length, FullName
