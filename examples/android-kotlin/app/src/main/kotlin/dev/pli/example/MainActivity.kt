package dev.pli.example

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier

class MainActivity : ComponentActivity() {
    private val editor: EditorViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme {
                var tab by rememberSaveable { mutableStateOf(0) }
                Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                    TabRow(selectedTabIndex = tab) {
                        // Day one: drop in the editor.
                        Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Editor") })
                        // Your own screens, with Pli's text blocks, toolbar and menus as the pieces.
                        Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Native") })
                        // The same documents, through the Kotlin API.
                        Tab(selected = tab == 2, onClick = { tab = 2 }, text = { Text("Build your own") })
                    }
                    Box(Modifier.weight(1f)) {
                        when (tab) {
                            0 -> FullEditorScreen()
                            1 -> NativeEditorScreen()
                            else -> EditorScreen(editor)
                        }
                    }
                }
            }
        }
    }
}
