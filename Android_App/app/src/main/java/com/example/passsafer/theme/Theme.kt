package com.example.passsafer.theme

import androidx.compose.runtime.Composable

@Composable
fun PassSaferTheme(
    darkTheme: Boolean = true,
    dynamicColor: Boolean = false,
    content: @Composable () -> Unit
) {
    com.example.passsafer.ui.theme.PassSaferTheme(
        content = content
    )
}
