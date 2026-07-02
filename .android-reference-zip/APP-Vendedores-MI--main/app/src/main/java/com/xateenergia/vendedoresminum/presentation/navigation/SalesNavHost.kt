package com.xateenergia.vendedoresminum.presentation.navigation

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.xateenergia.vendedoresminum.presentation.screens.auth.AccessDeniedScreen
import com.xateenergia.vendedoresminum.presentation.screens.auth.AuthGateScreen
import com.xateenergia.vendedoresminum.presentation.screens.auth.AuthStatus
import com.xateenergia.vendedoresminum.presentation.screens.auth.AuthViewModel
import com.xateenergia.vendedoresminum.presentation.screens.auth.LoginScreen
import com.xateenergia.vendedoresminum.presentation.screens.customer.CustomerDetailScreen
import com.xateenergia.vendedoresminum.presentation.screens.customer.CustomerListScreen
import com.xateenergia.vendedoresminum.presentation.screens.history.HistoryScreen
import com.xateenergia.vendedoresminum.presentation.screens.home.HomeScreen
import com.xateenergia.vendedoresminum.presentation.screens.importer.ImportScreen
import com.xateenergia.vendedoresminum.presentation.screens.settings.SettingsScreen
import com.xateenergia.vendedoresminum.presentation.screens.visit.VisitMapScreen

@Composable
fun SalesNavHost(
    authViewModel: AuthViewModel = hiltViewModel()
) {
    val authState by authViewModel.state.collectAsState()

    when (val status = authState.status) {
        AuthStatus.Checking -> AuthGateScreen()
        is AuthStatus.ConfigurationMissing -> LoginScreen(
            state = authState.copy(errorMessage = authState.errorMessage ?: status.message),
            onSignIn = authViewModel::signIn,
            onPasswordReset = authViewModel::sendPasswordReset,
            onMessageShown = authViewModel::clearMessages
        )
        AuthStatus.Unauthenticated -> LoginScreen(
            state = authState,
            onSignIn = authViewModel::signIn,
            onPasswordReset = authViewModel::sendPasswordReset,
            onMessageShown = authViewModel::clearMessages
        )
        is AuthStatus.AccessDenied -> AccessDeniedScreen(
            message = status.message,
            onBackToLogin = authViewModel::acknowledgeAccessDenied
        )
        is AuthStatus.Authenticated -> AuthenticatedNavHost(
            onLogoutClick = authViewModel::logout
        )
    }
}

@Composable
private fun AuthenticatedNavHost(
    onLogoutClick: () -> Unit
) {
    val navController = rememberNavController()

    NavHost(
        navController = navController,
        startDestination = Destinations.Home
    ) {
        composable(Destinations.Home) {
            HomeScreen(
                onImportClick = { navController.navigate(Destinations.Import) },
                onNewVisitClick = { navController.navigate(Destinations.Visit) },
                onCustomersClick = { navController.navigate(Destinations.Customers) },
                onSettingsClick = { navController.navigate(Destinations.Settings) },
                onHistoryClick = { navController.navigate(Destinations.History) },
                onLogoutClick = onLogoutClick
            )
        }
        composable(Destinations.Import) {
            ImportScreen(onBack = navController::popBackStack)
        }
        composable(Destinations.Visit) {
            VisitMapScreen(
                onBack = navController::popBackStack,
                onCustomerClick = { customerId -> navController.navigate(Destinations.customerDetail(customerId)) }
            )
        }
        composable(Destinations.Customers) {
            CustomerListScreen(
                onBack = navController::popBackStack,
                onCustomerClick = { customerId -> navController.navigate(Destinations.customerDetail(customerId)) }
            )
        }
        composable(Destinations.Settings) {
            SettingsScreen(onBack = navController::popBackStack)
        }
        composable(Destinations.History) {
            HistoryScreen(onBack = navController::popBackStack)
        }
        composable(
            route = Destinations.CustomerDetail,
            arguments = listOf(navArgument("customerId") { type = NavType.LongType })
        ) { entry ->
            CustomerDetailScreen(
                customerId = entry.arguments?.getLong("customerId") ?: 0L,
                onBack = navController::popBackStack
            )
        }
    }
}
