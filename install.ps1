# Installs the nmbrs CLI on Windows and starts its setup.
#
#   powershell -ExecutionPolicy Bypass -c "iex ((New-Object Net.WebClient).DownloadString('https://github.com/ig-shadow-walker/nmbrsCLI/releases/latest/download/install.ps1'))"
#
# Options: set these environment variables first, or pass the parameters when running the script as a file.
#   NMBRS_VERSION         -Version v0.2.0     a specific release (default: latest)
#   NMBRS_INSTALL_DIR     -InstallDir <path>  where nmbrs.exe goes (default: %LOCALAPPDATA%\Programs\nmbrs)
#   NMBRS_NO_SETUP=1      -NoSetup            don't start `nmbrs setup` afterwards
#   NMBRS_NO_MODIFY_PATH=1 -NoModifyPath      don't add the folder to your user PATH
#   NMBRS_DOWNLOAD_URL                        download from this folder instead of the GitHub release
#
# Running it again updates nmbrs to the latest release and keeps your credentials.
# Works in Windows PowerShell 5.1 and PowerShell 7. Keep this file ASCII-only: 5.1 may read it as ANSI.

param(
  [string]$Version = $env:NMBRS_VERSION,
  [string]$InstallDir = $env:NMBRS_INSTALL_DIR,
  [switch]$NoSetup,
  [switch]$NoModifyPath
)

function Install-Nmbrs {
  param([string]$Version, [string]$InstallDir, [bool]$NoSetup, [bool]$NoModifyPath)

  $ErrorActionPreference = 'Stop'
  $ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads in 5.1 many times slower
  $Repo = 'ig-shadow-walker/nmbrsCLI'

  if (-not $Version) { $Version = 'latest' }
  if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'Programs\nmbrs' }
  if ($env:NMBRS_NO_SETUP) { $NoSetup = $true }
  if ($env:NMBRS_NO_MODIFY_PATH) { $NoModifyPath = $true }

  $arch = Get-NmbrsArch
  $asset = "nmbrs-windows-$arch.exe"

  if ($env:NMBRS_DOWNLOAD_URL) { $base = $env:NMBRS_DOWNLOAD_URL.TrimEnd('/') }
  elseif ($Version -eq 'latest') { $base = "https://github.com/$Repo/releases/latest/download" }
  else { $base = "https://github.com/$Repo/releases/download/$Version" }

  # Older Windows PowerShell may not offer TLS 1.2 by default; GitHub requires it.
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  } catch { }

  $tmp = Join-Path ([IO.Path]::GetTempPath()) ("nmbrs-install-" + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Write-Host "Downloading $asset ($Version)..."
    $exe = Join-Path $tmp 'nmbrs.exe'
    $sums = Join-Path $tmp 'SHA256SUMS'
    Get-NmbrsFile "$base/$asset" $exe
    Get-NmbrsFile "$base/SHA256SUMS" $sums

    $expected = $null
    foreach ($line in Get-Content $sums) {
      $parts = $line.Trim() -split '\s+'
      if ($parts.Count -ge 2 -and ($parts[1] -eq $asset -or $parts[1] -eq "*$asset")) { $expected = $parts[0].ToLower() }
    }
    if (-not $expected) { throw "$asset is not listed in SHA256SUMS" }
    $actual = (Get-FileHash -Path $exe -Algorithm SHA256).Hash.ToLower()
    if ($actual -ne $expected) { throw "checksum mismatch for $asset (expected $expected, got $actual); not installing" }

    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $dest = Join-Path $InstallDir 'nmbrs.exe'
    if (Test-Path $dest) {
      # A running .exe can't be overwritten on Windows, but it can be renamed out of the way.
      $old = "$dest.old"
      Remove-Item $old -Force -ErrorAction SilentlyContinue
      try { Move-Item $dest $old -Force } catch { throw "couldn't replace $dest. Close any running nmbrs and try again." }
    }
    Move-Item $exe $dest -Force
    Unblock-File $dest -ErrorAction SilentlyContinue

    $installed = & $dest --version
    if ($LASTEXITCODE -ne 0) { throw "$dest was installed but does not run on this machine" }
    Write-Host "Installed nmbrs $installed in $dest"
  } finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }

  Add-NmbrsToPath $InstallDir $NoModifyPath

  if ($NoSetup) {
    Write-Host "Next: run 'nmbrs setup' to connect to Nmbrs Reporting."
  } elseif ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) {
    Write-Host ""
    & $dest setup
    if ($LASTEXITCODE -ne 0) { Write-Host "Setup didn't finish. Run 'nmbrs setup' any time to try again." }
  } else {
    Write-Host "Next: run 'nmbrs setup' in a terminal to connect to Nmbrs Reporting."
  }
}

function Get-NmbrsArch {
  $os = $null
  try { $os = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString() } catch { }
  if (-not $os) {
    $os = $env:PROCESSOR_ARCHITECTURE
    if ($env:PROCESSOR_ARCHITEW6432) { $os = $env:PROCESSOR_ARCHITEW6432 }
  }
  switch -Regex ($os) {
    '^(X64|AMD64)$' { return 'x64' }
    '^(Arm64|ARM64)$' { return 'arm64' }
    default { throw "unsupported processor: $os (nmbrs needs 64-bit Windows 10 1809 or newer)" }
  }
}

function Get-NmbrsFile([string]$Url, [string]$OutFile) {
  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
  } catch {
    throw "could not download ${Url}: $($_.Exception.Message)"
  }
}

function Add-NmbrsToPath([string]$Dir, [bool]$NoModifyPath) {
  $norm = $Dir.TrimEnd('\')
  # Read the raw value so entries like %USERPROFILE%\bin stay unexpanded when written back.
  $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
  try {
    $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    $entries = @($current -split ';' | Where-Object { $_ })
    $present = $entries | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ieq $norm }
    if (-not $present) {
      if ($NoModifyPath) {
        Write-Host "Note: $Dir is not on your PATH."
      } else {
        $key.SetValue('Path', (($entries + $Dir) -join ';'), [Microsoft.Win32.RegistryValueKind]::ExpandString)
        # Setting any user variable through .NET broadcasts the change, so new terminals see the new PATH.
        [Environment]::SetEnvironmentVariable('NMBRS_INSTALLER', '1', 'User')
        [Environment]::SetEnvironmentVariable('NMBRS_INSTALLER', $null, 'User')
        Write-Host "Added $Dir to your user PATH. Open a new terminal for the nmbrs command to be found."
      }
    }
  } finally {
    $key.Close()
  }
  if (-not (($env:Path -split ';') | Where-Object { $_.TrimEnd('\') -ieq $norm })) { $env:Path = "$Dir;$env:Path" }
}

Install-Nmbrs -Version $Version -InstallDir $InstallDir -NoSetup $NoSetup.IsPresent -NoModifyPath $NoModifyPath.IsPresent
