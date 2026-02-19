

export async function Retry<T>( action: () => Promise<T>, retryInterval = 2000, maxAttemptCount = 3 )
{
    const exceptions = [];
    for ( let attempted = 0 ; attempted < maxAttemptCount ; attempted++ )
    {
        try
        {
            if ( attempted > 0 )
                await sleep( retryInterval );
            return await action( );
        }
        catch ( e )
        {

            console.warn( `Attempt ${attempted + 1} of ${maxAttemptCount} failed. ${JSON.stringify(e)}`, e );
           
            exceptions.push( e );
        }
    }

    throw JSON.stringify(exceptions);
}

function sleep( ms: number ) { return new Promise( resolve => setTimeout( resolve, ms ) ); }