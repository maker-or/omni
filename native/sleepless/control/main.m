#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>

static NSString *StatusName(SMAppServiceStatus status) API_AVAILABLE(macos(13.0)) {
    switch (status) {
        case SMAppServiceStatusNotRegistered: return @"not-registered";
        case SMAppServiceStatusEnabled: return @"enabled";
        case SMAppServiceStatusRequiresApproval: return @"requires-approval";
        case SMAppServiceStatusNotFound: return @"not-found";
    }
    return @"error";
}

static void PrintResult(NSString *status, NSError *error) {
    NSMutableDictionary *body = [@{ @"status": status } mutableCopy];
    if (error) body[@"error"] = error.localizedDescription;
    NSData *data = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];
    fwrite(data.bytes, 1, data.length, stdout);
    fputc('\n', stdout);
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (@available(macOS 13.0, *)) {
            NSString *command = argc > 1 ? [NSString stringWithUTF8String:argv[1]] : @"status";
            SMAppService *service = [SMAppService daemonServiceWithPlistName:@"com.maker-or.omni.sleeplessd.plist"];
            NSError *error = nil;
            if ([command isEqualToString:@"register"] &&
                (service.status == SMAppServiceStatusNotRegistered ||
                 service.status == SMAppServiceStatusNotFound)) {
                [service registerAndReturnError:&error];
            } else if ([command isEqualToString:@"unregister"]) {
                [service unregisterAndReturnError:&error];
            } else if ([command isEqualToString:@"open-settings"]) {
                [SMAppService openSystemSettingsLoginItems];
            } else if (![command isEqualToString:@"status"]) {
                error = [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl"
                                             code:2
                                         userInfo:@{NSLocalizedDescriptionKey:
                                                        [NSString stringWithFormat:@"Unknown command: %@", command]}];
            }
            PrintResult(StatusName(service.status), error);
            return error ? 1 : 0;
        }
        PrintResult(@"unsupported", [NSError errorWithDomain:@"com.maker-or.omni.sleeplessctl"
                                                         code:1
                                                     userInfo:@{NSLocalizedDescriptionKey:
                                                                    @"macOS 13 or newer is required."}]);
        return 1;
    }
}
