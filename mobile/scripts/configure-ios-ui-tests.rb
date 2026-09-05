require "xcodeproj"

project_path = File.expand_path("../ios/TurtleMaps.xcodeproj", __dir__)
project = Xcodeproj::Project.open(project_path)
app_target = project.targets.find { |target| target.name == "TurtleMaps" }
abort "TurtleMaps app target not found" unless app_target

test_target = project.targets.find { |target| target.name == "TurtleMapsUITests" }
unless test_target
  test_target = project.new_target(:ui_test_bundle, "TurtleMapsUITests", :ios, "17.0")
  test_target.add_dependency(app_target)
end

test_group = project.main_group.find_subpath("TurtleMapsUITests", true)
test_group.set_source_tree("<group>")
test_file_path = File.expand_path("../ios/TurtleMapsUITests/GoogleAuthenticationUITests.swift", __dir__)
test_file = test_group.files.find { |file| file.real_path.to_s == test_file_path }
test_file ||= test_group.new_file(test_file_path)

unless test_target.source_build_phase.files_references.include?(test_file)
  test_target.source_build_phase.add_file_reference(test_file)
end

test_target.build_configurations.each do |configuration|
  configuration.build_settings["PRODUCT_BUNDLE_IDENTIFIER"] = "com.turtlebuddy.app.uitests"
  configuration.build_settings["PRODUCT_NAME"] = "$(TARGET_NAME)"
  configuration.build_settings["GENERATE_INFOPLIST_FILE"] = "YES"
  configuration.build_settings["SWIFT_VERSION"] = "5.0"
  configuration.build_settings["TEST_TARGET_NAME"] = "TurtleMaps"
  configuration.build_settings["CODE_SIGN_STYLE"] = "Automatic"
  configuration.build_settings["LD_RUNPATH_SEARCH_PATHS"] = [
    "$(inherited)",
    "@executable_path/Frameworks",
    "@loader_path/Frameworks",
  ]
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(app_target)
scheme.add_test_target(test_target)
scheme.set_launch_target(app_target)
scheme.save_as(project_path, "TurtleMapsGoogleAuth", true)

puts "Configured TurtleMapsGoogleAuth UI test scheme"
