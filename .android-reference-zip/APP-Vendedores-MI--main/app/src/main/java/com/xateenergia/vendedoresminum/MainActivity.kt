package com.xateenergia.vendedoresminum

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.xateenergia.vendedoresminum.presentation.navigation.SalesNavHost
import com.xateenergia.vendedoresminum.presentation.theme.VendedoresMinumTheme
import dagger.hilt.android.AndroidEntryPoint

@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            VendedoresMinumTheme {
                SalesNavHost()
            }
        }
    }
}

