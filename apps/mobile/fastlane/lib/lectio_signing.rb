# frozen_string_literal: true

# Signing helpers for the Fastfile (#261), kept here so that
# test/lectio_signing_test.rb (run by ci.yml) can test them without fastlane.
# Plain Ruby only: no fastlane, no gems.

require "fileutils"
require "tmpdir"

module LectioSigning
  module_function

  # Writes content to path as a new file created with mode 600, so it is never
  # readable by others, not even between the write and a chmod. A file left at
  # path by an earlier run is removed first (an existing file keeps its mode).
  def write_private_file(path, content)
    FileUtils.rm_f(path)
    File.open(path, File::WRONLY | File::CREAT | File::EXCL | File::BINARY, 0o600) { |file| file.write(content) }
    path
  end

  # value escaped as a java.util.Properties value, which Gradle reads as
  # ISO-8859-1: a backslash, tab, line break or form feed as its escape, a
  # leading space as "\ " (Properties.load skips leading whitespace), the
  # separators and comment marks with a backslash, and any other character
  # outside printable ASCII as \uXXXX (UTF-16 code units, so a character
  # beyond the BMP becomes a surrogate pair). Properties.load reads the result
  # back as exactly value. Raises ArgumentError, without the value, when value
  # is not valid UTF-8.
  def java_properties_escape(value)
    text = value.dup.force_encoding(Encoding::UTF_8)
    raise ArgumentError, "a signing value is not valid UTF-8" unless text.valid_encoding?

    text.each_char.with_index.map { |char, index| escape_char(char, index) }.join
  end

  ESCAPES = { "\\" => "\\\\", "\t" => "\\t", "\n" => "\\n", "\r" => "\\r", "\f" => "\\f" }.freeze
  private_constant :ESCAPES

  def escape_char(char, index)
    return ESCAPES[char] if ESCAPES.key?(char)
    return "\\ " if char == " " && index.zero?
    return "\\#{char}" if "=:#!".include?(char)
    return char if char.ord.between?(0x20, 0x7e)

    char.encode(Encoding::UTF_16BE).unpack("n*").map { |unit| format("\\u%04X", unit) }.join
  end
  private_class_method :escape_char

  # A gradle.properties file setting each of properties (name => value), the
  # values escaped with java_properties_escape. The names are fixed ASCII keys.
  def gradle_properties(properties)
    properties.map { |name, value| "#{name}=#{java_properties_escape(value)}\n" }.join
  end

  # Runs the block with GRADLE_USER_HOME pointing at a new directory under
  # parent (mode 700) whose gradle.properties (mode 600) holds properties and
  # turns the Gradle daemon off. Afterwards, whether the block passed or failed,
  # GRADLE_USER_HOME is restored and the directory deleted. Gradle reads
  # gradle.properties from GRADLE_USER_HOME, so values reach it without the
  # command line (-P or GRADLE_OPTS, visible to ps) or environment variable
  # names a POSIX shell drops (gradlew runs under /bin/sh). Returns the block's
  # value; the block gets the directory.
  def with_gradle_user_home(properties, parent: Dir.tmpdir)
    home = Dir.mktmpdir("lectio-gradle-", parent)
    previous = ENV.fetch("GRADLE_USER_HOME", nil)
    begin
      File.chmod(0o700, home)
      write_private_file(File.join(home, "gradle.properties"),
                         "org.gradle.daemon=false\n#{gradle_properties(properties)}")
      ENV["GRADLE_USER_HOME"] = home
      yield home
    ensure
      ENV["GRADLE_USER_HOME"] = previous
      FileUtils.rm_rf(home)
    end
  end
end
