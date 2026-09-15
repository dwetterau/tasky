Pod::Spec.new do |s|
  s.name = 'TaskyScale'
  s.version = '1.0.0'
  s.summary = 'Tasky iOS scale connection'
  s.description = 'Local Expo module for reading a Yunmai scale with CoreBluetooth.'
  s.author = 'Tasky'
  s.homepage = 'https://example.invalid/tasky-scale'
  s.license = { :type => 'Private' }
  s.source = { :path => '.' }
  s.platforms = { :ios => '16.4' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.frameworks = 'CoreBluetooth'
  s.source_files = '**/*.swift'
  s.swift_version = '5.9'
end
