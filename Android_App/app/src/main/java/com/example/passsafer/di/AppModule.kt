package com.example.passsafer.di

import android.content.Context
import com.example.passsafer.data.crypto.CryptoManager
import com.example.passsafer.data.repository.VaultRepository
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object AppModule {
    @Provides
    @Singleton
    fun provideCryptoManager(): CryptoManager = CryptoManager()

    @Provides
    @Singleton
    fun provideVaultRepository(
        @ApplicationContext context: Context,
        cryptoManager: CryptoManager
    ): VaultRepository = VaultRepository(context, cryptoManager)

    @Provides
    @Singleton
    fun provideSessionManager(): com.example.passsafer.data.session.SessionManager = com.example.passsafer.data.session.SessionManager()

    @Provides
    @Singleton
    fun provideLicenseManager(@ApplicationContext context: Context): com.example.passsafer.data.license.LicenseManager = com.example.passsafer.data.license.LicenseManager(context)
}
