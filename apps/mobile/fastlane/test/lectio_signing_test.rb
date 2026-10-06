# frozen_string_literal: true

# Tests for lib/lectio_signing.rb. ci.yml runs them on every PR:
#   ruby apps/mobile/fastlane/test/lectio_signing_test.rb
# Plain Ruby and minitest (a bundled gem); the round trip through
# java.util.Properties runs when `java` (11 or later) is on the PATH, and must
# run when LECTIO_REQUIRE_JAVA=1 (as in ci.yml).

require "minitest/autorun"
require "open3"
require "tmpdir"

require_relative "../lib/lectio_signing"

class LectioSigningTest < Minitest::Test
  # Awkward but legal signing values: leading and trailing spaces, backslashes,
  # separators, comment marks, line breaks and characters beyond Latin-1.
  VALUES = [
    "plain-Password1",
    " leading space",
    "  two leading spaces",
    "trailing space ",
    "back\\slash\\\\double",
    "key=value:colon",
    "#not a comment",
    "!not a comment either",
    "tab\there",
    "line\nbreak\r\nand form\ffeed",
    "café ß",
    "пароль",
    "emoji \u{1F511}",
    "ctrl\u0001char",
    ""
  ].freeze

  def test_escapes_what_properties_load_would_change
    assert_equal "plain-Password1", LectioSigning.java_properties_escape("plain-Password1")
    assert_equal "\\ leading space", LectioSigning.java_properties_escape(" leading space")
    assert_equal "\\  two", LectioSigning.java_properties_escape("  two")
    assert_equal "trailing space ", LectioSigning.java_properties_escape("trailing space ")
    assert_equal "a\\\\b", LectioSigning.java_properties_escape("a\\b")
    assert_equal "\\t\\n\\r\\f", LectioSigning.java_properties_escape("\t\n\r\f")
    assert_equal "k\\=v\\:c \\#x \\!y", LectioSigning.java_properties_escape("k=v:c #x !y")
    assert_equal "", LectioSigning.java_properties_escape("")
  end

  def test_escapes_everything_outside_printable_ascii_as_utf16_units
    assert_equal "caf\\u00E9", LectioSigning.java_properties_escape("café")
    assert_equal "\\u043F", LectioSigning.java_properties_escape("п")
    assert_equal "\\uD83D\\uDD11", LectioSigning.java_properties_escape("\u{1F511}")
    assert_equal "\\u0001\\u007F", LectioSigning.java_properties_escape("\u0001\u007f")
    # A value from ENV may be tagged with another encoding; its bytes are read as UTF-8.
    assert_equal "\\u00E9", LectioSigning.java_properties_escape("é".b)
  end

  def test_refuses_invalid_utf8_without_showing_the_value
    error = assert_raises(ArgumentError) { LectioSigning.java_properties_escape("secret\xFF".b) }
    refute_includes error.message, "secret"
  end

  def test_gradle_properties_writes_one_escaped_line_per_property
    assert_equal "a.b=\\ x\nc.d=y\\\\z\n", LectioSigning.gradle_properties("a.b" => " x", "c.d" => "y\\z")
    assert_equal "", LectioSigning.gradle_properties({})
  end

  def test_write_private_file_creates_mode_600_even_over_an_existing_file
    Dir.mktmpdir do |dir|
      path = File.join(dir, "secret")
      File.write(path, "old")
      File.chmod(0o644, path)
      assert_equal path, LectioSigning.write_private_file(path, "newé".b)
      assert_equal 0o600, File.stat(path).mode & 0o777
      assert_equal "newé".b, File.binread(path)
    end
  end

  def test_with_gradle_user_home_holds_the_properties_privately_only_inside_the_block
    Dir.mktmpdir do |parent|
      previous = ENV.fetch("GRADLE_USER_HOME", nil)
      seen = nil
      result = LectioSigning.with_gradle_user_home({ "android.injected.signing.store.password" => " pw" },
                                                   parent: parent) do |home|
        seen = home
        assert_equal home, ENV.fetch("GRADLE_USER_HOME")
        assert_equal File.join(parent, File.basename(home)), home
        assert_equal 0o700, File.stat(home).mode & 0o777
        properties = File.join(home, "gradle.properties")
        assert_equal 0o600, File.stat(properties).mode & 0o777
        assert_equal "org.gradle.daemon=false\nandroid.injected.signing.store.password=\\ pw\n",
                     File.read(properties)
        :built
      end
      assert_equal :built, result
      refute File.exist?(seen)
      assert_equal previous, ENV.fetch("GRADLE_USER_HOME", nil)
    end
  end

  def test_with_gradle_user_home_cleans_up_when_the_block_fails
    outer = ENV.fetch("GRADLE_USER_HOME", nil)
    Dir.mktmpdir do |parent|
      ENV["GRADLE_USER_HOME"] = "/previous/home"
      seen = nil
      assert_raises(RuntimeError) do
        LectioSigning.with_gradle_user_home({ "a" => "b" }, parent: parent) do |home|
          seen = home
          raise "build failed"
        end
      end
      refute File.exist?(seen)
      assert_equal "/previous/home", ENV.fetch("GRADLE_USER_HOME")
    ensure
      ENV["GRADLE_USER_HOME"] = outer
    end
  end

  # Writes VALUES with gradle_properties, loads the file with java.util.Properties
  # (as Gradle does) and checks every value comes back byte for byte.
  def test_java_properties_reads_back_every_value_exactly
    unless system("java", "-version", out: File::NULL, err: File::NULL)
      # ci.yml sets LECTIO_REQUIRE_JAVA so that this check cannot be skipped there.
      flunk "java is not on the PATH" if ENV["LECTIO_REQUIRE_JAVA"] == "1"
      skip "java is not on the PATH"
    end

    Dir.mktmpdir do |dir|
      properties = VALUES.each_with_index.to_h { |value, index| ["value.#{index}", value] }
      file = File.join(dir, "gradle.properties")
      File.binwrite(file, LectioSigning.gradle_properties(properties))
      source = File.join(dir, "Load.java")
      File.write(source, <<~JAVA)
        import java.io.FileInputStream;
        import java.nio.charset.StandardCharsets;
        import java.util.Properties;

        public class Load {
          public static void main(String[] args) throws Exception {
            Properties properties = new Properties();
            try (FileInputStream in = new FileInputStream(args[0])) { properties.load(in); }
            for (int i = 0; i < Integer.parseInt(args[1]); i++) {
              String value = properties.getProperty("value." + i);
              StringBuilder hex = new StringBuilder();
              for (byte b : value.getBytes(StandardCharsets.UTF_8)) hex.append(String.format("%02x", b));
              System.out.println(hex);
            }
          }
        }
      JAVA
      output, status = Open3.capture2("java", source, file, VALUES.length.to_s)
      assert status.success?, "java failed"
      assert_equal VALUES.map { |value| value.unpack1("H*") }, output.lines.map(&:chomp)
    end
  end
end
