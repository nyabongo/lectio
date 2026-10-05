package io.github.nyabongo.lectio

import com.ryanheise.audioservice.AudioServiceActivity

// L-104: audio_service keeps the Flutter engine alive for background audio and
// the lock-screen controls, so the activity extends its AudioServiceActivity.
class MainActivity : AudioServiceActivity()
