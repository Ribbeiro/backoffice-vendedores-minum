package com.xateenergia.vendedoresminum.data.database

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase
import com.xateenergia.vendedoresminum.data.dao.CustomerDao
import com.xateenergia.vendedoresminum.data.dao.PlannedRouteDao
import com.xateenergia.vendedoresminum.data.entities.CustomerEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteEntity
import com.xateenergia.vendedoresminum.data.entities.PlannedRouteStopEntity

@Database(
    entities = [
        CustomerEntity::class,
        PlannedRouteEntity::class,
        PlannedRouteStopEntity::class
    ],
    version = 2,  // ATUALIZADO para 2
    exportSchema = false
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun customerDao(): CustomerDao
    abstract fun plannedRouteDao(): PlannedRouteDao

    companion object {
        @Volatile
        private var INSTANCE: AppDatabase? = null

        fun getInstance(context: Context): AppDatabase {
            return INSTANCE ?: synchronized(this) {
                val instance = Room.databaseBuilder(
                    context.applicationContext,
                    AppDatabase::class.java,
                    "vendedores_minum.db"
                )
                    .addMigrations(MIGRATION_1_TO_2)  // ADICIONA A MIGRAÇÃO
                    .build()
                INSTANCE = instance
                instance
            }
        }

        // MIGRAÇÃO DA VERSÃO 1 PARA 2 (ADICIONA OS NOVOS CAMPOS)
        private val MIGRATION_1_TO_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE customers ADD COLUMN opportunity TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN cnpjCpf TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN externalId TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN email TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN responsavel TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN ultimaAtualizacao TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN distributor TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN responsableSalesperson TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN tags TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN expectedRevenue TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN origem TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN pipelineStage TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN clientName TEXT")
                database.execSQL("ALTER TABLE customers ADD COLUMN country TEXT")
            }
        }
    }
}