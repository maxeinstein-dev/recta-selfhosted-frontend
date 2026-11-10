package dev.maxsueleinstein.recta.capture

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Index
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase

/** Row states. PENDING rows are resent until the server answers 2xx; REJECTED rows were refused by the server and are kept. */
object QueueStatus {
    const val PENDING = "PENDING"
    const val SENT = "SENT"
    const val REJECTED = "REJECTED"
}

/** The local queue: the raw text of an allowed notification, how far it got, and how many times it was tried. */
@Entity(
    tableName = "captured_notifications",
    indices = [Index(value = ["dedupKey"], unique = true), Index(value = ["status"])],
)
data class CapturedNotificationEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val dedupKey: String,
    val packageName: String,
    val title: String?,
    val text: String,
    val postedAtMillis: Long,
    val status: String = QueueStatus.PENDING,
    val attempts: Int = 0,
    val lastError: String? = null,
    val createdAtMillis: Long,
    val sentAtMillis: Long? = null,
) {
    fun toItem() = CaptureItem(packageName, title, text, postedAtMillis)
}

@Dao
interface CaptureDao {
    /** Returns -1 when the dedup key already exists (the same notification posted again). */
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insert(row: CapturedNotificationEntity): Long

    @Query("SELECT * FROM captured_notifications WHERE status = 'PENDING' ORDER BY postedAtMillis ASC, id ASC LIMIT :limit")
    suspend fun pending(limit: Int): List<CapturedNotificationEntity>

    @Query("UPDATE captured_notifications SET status = 'SENT', sentAtMillis = :now, attempts = attempts + 1, lastError = NULL WHERE id IN (:ids)")
    suspend fun markSent(ids: List<Long>, now: Long)

    @Query("UPDATE captured_notifications SET attempts = attempts + 1, lastError = :error WHERE id IN (:ids)")
    suspend fun markAttempt(ids: List<Long>, error: String)

    @Query("UPDATE captured_notifications SET status = 'REJECTED', attempts = attempts + 1, lastError = :error WHERE id IN (:ids)")
    suspend fun markRejected(ids: List<Long>, error: String)

    @Query("SELECT COUNT(*) FROM captured_notifications WHERE status = :status")
    suspend fun count(status: String): Int

    /** Sent rows are kept for a while for the diagnostics counters, then dropped so the raw text does not pile up. */
    @Query("DELETE FROM captured_notifications WHERE status = 'SENT' AND sentAtMillis < :before")
    suspend fun purgeSent(before: Long): Int
}

// exportSchema is off: there is a single version. Turn it on (and set room.schemaLocation) with the first migration.
@Database(entities = [CapturedNotificationEntity::class], version = 1, exportSchema = false)
abstract class CaptureDatabase : RoomDatabase() {
    abstract fun dao(): CaptureDao

    companion object {
        @Volatile
        private var instance: CaptureDatabase? = null

        fun get(context: Context): CaptureDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(context.applicationContext, CaptureDatabase::class.java, "capture-queue.db")
                    .build()
                    .also { instance = it }
            }
    }
}

object CaptureRepository {
    /** Queues one captured notification. Returns false when it was already queued. */
    suspend fun enqueue(context: Context, item: CaptureItem, nowMillis: Long = System.currentTimeMillis()): Boolean {
        val row = CapturedNotificationEntity(
            dedupKey = NotificationFilter.dedupKey(item),
            packageName = item.packageName,
            title = item.title,
            text = item.text,
            postedAtMillis = item.postedAtMillis,
            createdAtMillis = nowMillis,
        )
        return CaptureDatabase.get(context).dao().insert(row) != -1L
    }
}
