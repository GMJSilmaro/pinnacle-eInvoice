-- Add validation results field to WP_INBOUND_STATUS table
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('WP_INBOUND_STATUS') 
    AND name = 'validationResults'
)
BEGIN
    ALTER TABLE WP_INBOUND_STATUS
    ADD validationResults TEXT NULL;
    
    PRINT 'Added validationResults column to WP_INBOUND_STATUS table';
END
ELSE
BEGIN
    PRINT 'validationResults column already exists in WP_INBOUND_STATUS table';
END

-- Add document field to WP_INBOUND_STATUS table
IF NOT EXISTS (
    SELECT * FROM sys.columns 
    WHERE object_id = OBJECT_ID('WP_INBOUND_STATUS') 
    AND name = 'document'
)
BEGIN
    ALTER TABLE WP_INBOUND_STATUS
    ADD document TEXT NULL;
    
    PRINT 'Added document column to WP_INBOUND_STATUS table';
END
ELSE
BEGIN
    PRINT 'document column already exists in WP_INBOUND_STATUS table';
END
