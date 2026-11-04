# Secure device-owned SSH files before atomic replacement or use.
param([Parameter(Mandatory=$true)][string]$Path)
$ErrorActionPreference = 'Stop'
$item = [IO.FileInfo]::new([IO.Path]::GetFullPath($Path))
if (!$item.Exists) { throw 'SSH file does not exist' }
if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing reparse point' }
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($sid)
$acl.SetAccessRuleProtection($true, $false)
foreach ($id in @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new(
        [Security.Principal.SecurityIdentifier]::new($id),
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.AccessControlType]::Allow)
    $acl.AddAccessRule($rule)
}
# Windows PowerShell/.NET Framework API: no module autoload through an inherited PSModulePath.
[IO.File]::SetAccessControl($item.FullName, $acl)
