const Task = require('../models/task');
const ArchivedTask = require('../models/archivedTask');
const Meeting = require('../models/meeting');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

/**
 * Runs the database optimization and cleanup tasks:
 * 1. Archives completed tasks older than 6 months to `archived_tasks`.
 * 2. Prunes past meetings older than 6 months.
 * 3. Safely runs compact command on database collections to reclaim storage if supported.
 */
async function runDatabaseCleanup() {
  logger.info('Database Cleanup: Starting scheduled cleanup and optimization process...');
  const session = await mongoose.startSession();

  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // 1. Archive Completed Tasks older than 6 months
    const tasksToArchive = await Task.find({
      status: 'Completed',
      updatedAt: { $lt: sixMonthsAgo }
    });

    if (tasksToArchive.length > 0) {
      logger.info(`Database Cleanup: Found ${tasksToArchive.length} completed tasks older than 6 months to archive.`);

      await session.withTransaction(async () => {
        const archivedDocs = tasksToArchive.map(task => {
          const obj = task.toObject();
          obj._id = task._id; // Keep original ID
          obj.archivedAt = new Date();
          return obj;
        });

        // Insert into archived collection
        await ArchivedTask.insertMany(archivedDocs, { ordered: false, session });
        
        // Delete from active tasks
        const taskIds = tasksToArchive.map(t => t._id);
        await Task.deleteMany({ _id: { $in: taskIds } }, { session });
      });

      logger.info(`Database Cleanup: Successfully archived ${tasksToArchive.length} tasks.`);
    } else {
      logger.info('Database Cleanup: No completed tasks older than 6 months found to archive.');
    }

    // 2. Prune meetings older than 6 months
    const meetingCleanupResult = await Meeting.deleteMany({
      endTime: { $lt: sixMonthsAgo }
    });
    if (meetingCleanupResult.deletedCount > 0) {
      logger.info(`Database Cleanup: Pruned ${meetingCleanupResult.deletedCount} past meetings older than 6 months.`);
    }

    // 3. Compact collections to reclaim disk space (M0 Atlas free tier may deny command; run safely)
    const collectionsToCompact = ['tasks', 'archived_tasks', 'meetings', 'teams', 'temp_cache'];
    for (const col of collectionsToCompact) {
      try {
        await mongoose.connection.db.command({ compact: col });
        logger.info(`Database Cleanup: Collection "${col}" compacted successfully.`);
      } catch (compactErr) {
        // Log at debug level to keep output clean on unsupported environments (like Atlas M0)
        logger.debug(`Database Cleanup: Compact command not supported/allowed for collection "${col}": ${compactErr.message}`);
      }
    }

    logger.info('Database Cleanup: Process completed successfully.');
  } catch (error) {
    logger.error('Database Cleanup: Error during database cleanup and optimization:', error);
  } finally {
    await session.endSession();
  }
}

module.exports = { runDatabaseCleanup };
